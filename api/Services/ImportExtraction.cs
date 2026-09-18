using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// The AI reading pipeline. The browser extracts the PDF's text on the device and submits only
/// that text, so this service never holds a document, an object-store key, or an upload session.
///
/// One rule shapes the transactions here: a model read can take minutes, so it never runs inside
/// the per-user mutation transaction. Holding the advisory lock across it would block every other
/// request from that account and lose the whole read if the connection drops. Each pass therefore
/// claims its work in a short transaction, calls the model outside any transaction, and commits
/// the result in a second short transaction — including when the browser has already given up,
/// because the read has been paid for either way.
public sealed partial class ImportService
{
    public const int DailyLimit = 150;
    private static readonly TimeSpan SourceRetention = TimeSpan.FromHours(24);

    /// Accepts the extracted text and reads its outline. Submitting the same document again while
    /// an unfinished import exists continues that import rather than starting a second one.
    public async Task<ImportView> Create(ImportSourceInput input, CancellationToken ct)
    {
        var pages = ImportSourceText.Normalize(input);
        var hash = ImportSourceText.Hash(pages);
        var sourceJson = Json.Write(pages);
        Guid importId;
        bool readOutline;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.FirstOrDefaultAsync(i => i.DocumentHash == hash && i.PromptVersion == WorkoutAi.PromptVersion
                && (i.Status == ImportStatus.Pending || i.Status == ImportStatus.Ready || i.Status == ImportStatus.Accepted), ct);
            if (import == null)
            {
                import = new AiImport
                {
                    UserId = db.CurrentUser!.Value, DocumentHash = hash, PromptVersion = WorkoutAi.PromptVersion,
                    FileName = input.FileName.Trim(), Pages = input.PageCount,
                    Status = ImportStatus.Pending, Stage = "outline",
                    PageCoverageJson = Json.Write(ImportSourceText.Coverage(pages, input.PageCount))
                };
                db.Imports.Add(import);
            }
            if (import.Status == ImportStatus.Pending && string.IsNullOrEmpty(import.SourceTextJson))
            {
                import.SourceTextJson = sourceJson;
                import.SourceExpiresAt = DateTime.UtcNow.Add(SourceRetention);
                import.Error = ""; import.Revision++;
            }
            readOutline = import.Status == ImportStatus.Pending && import.Stage == "outline";
            await db.SaveChangesAsync(ct);
            importId = import.Id;
            await gate.Commit(ct);
        }
        db.ChangeTracker.Clear();
        if (readOutline) return await ReadOutline(importId, pages, ct);
        return await Get(importId, ct);
    }

    /// One outline pass. It reads a page-by-page view of the document, which for a large book is
    /// only the opening lines of each page: enough to locate the schedule, cheap enough that a
    /// hundred pages of coaching prose cost almost nothing.
    private async Task<ImportView> ReadOutline(Guid importId, List<ImportPageText> pages, CancellationToken ct)
    {
        var user = db.CurrentUser!.Value;
        await using (var claim = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            Validation.Require(import!.Status == ImportStatus.Pending && import.Stage == "outline", "This import has already been read.", 409);
            await Meter(import, ct);
            await db.SaveChangesAsync(ct);
            await claim.Commit(ct);
        }
        db.ChangeTracker.Clear();

        AiOutlineResult result;
        try
        {
            result = await ai.Outline(ImportSourceText.Outline(pages), [], AuthService.Hash(user.ToString())[..32], ct);
        }
        catch (DomainException ex)
        {
            await FailImport(importId, ex.Message);
            throw;
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            // A transport or provider fault is not the document's fault. The extracted text is
            // kept so the same import can be read again without re-reading the PDF.
            await RecordRetryableFailure(importId, "Reading this PDF did not finish. Try again.");
            throw;
        }

        // The read is paid for and complete: commit it even if the browser has since disconnected.
        var settle = CancellationToken.None;
        DomainException? rejected = null;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, settle))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
            if (import is not null && import.Status == ImportStatus.Pending && import.Stage == "outline")
            {
                try
                {
                    await ApplyOutline(import, result, settle);
                    if (import.Status == ImportStatus.Ready) ClearSource(import);
                    import.Revision++;
                    await db.SaveChangesAsync(settle);
                }
                catch (DomainException ex)
                {
                    // The account lock is not reentrant, so the outcome is recorded once this
                    // gate has closed rather than from inside it.
                    db.ChangeTracker.Clear();
                    rejected = ex;
                }
            }
            await gate.Commit(settle);
        }
        if (rejected is not null)
        {
            await FailImport(importId, rejected.Message);
            throw rejected;
        }
        return await Get(importId, ct);
    }

    private async Task ApplyOutline(AiImport import, AiOutlineResult result, CancellationToken ct)
    {
        import.Model = result.Model; import.InputTokens += result.InputTokens; import.OutputTokens += result.OutputTokens;
        import.Error = "";
        if (result.LegacyProgram is { } legacy)
        {
            var draft = await ToDraft(legacy, ct);
            // A whole-program answer holds the same days as a sectioned one and needs the same
            // reconciliation; it simply has no chunk to attribute a notice to.
            var shaped = ReconcileDayShape(draft.Workouts);
            draft = draft with { Workouts = shaped.Workouts };
            if (shaped.Notices.Count > 0) import.NoticesJson = Json.Write(shaped.Notices.TakeLast(40).ToList());
            await ValidateDraft(draft, ct);
            ValidateDraftPages(draft, import.PageCoverageJson);
            import.DraftJson = Json.Write(draft); import.Stage = "done"; import.Status = ImportStatus.Ready;
            import.ChunksDone = 1; import.ChunksTotal = 1;
            UpdateCounters(import, draft);
            return;
        }
        // Exercise matching is local and happens after each chunk is parsed. The catalog is
        // deliberately absent from outline/extraction requests so a long library cannot consume
        // context tokens or bias the transcription toward a near match.
        var alternatives = result.Outline!.Alternatives ?? [];
        if (alternatives.Count > 1)
        {
            import.AlternativesJson = Json.Write(alternatives.Select(a => new ImportAlternative(a.Id,
                ImportNormalization.Label(a.Name, 200, a.Id), ImportNormalization.Text(a.Description, 4000),
                a.Chunks.Count, a.Chunks.Sum(c => c.DayCount), a.Chunks.Select(ToImportChunk).ToList())).ToList());
            import.Stage = "select"; import.Status = ImportStatus.Pending; import.ChunksDone = 0; import.ChunksTotal = 0;
            import.DraftJson = Json.Write(new ImportDraft(ProgramTitle(result.Outline.ProgramTitle, import.FileName), ImportNormalization.Text(result.Outline.Description, 4000), []));
            return;
        }
        var selected = alternatives.Count == 1 ? alternatives[0] : null;
        var chunks = SplitChunks((selected?.Chunks ?? result.Outline.Chunks).Select(c => c with { }).ToList());
        ValidateChunkPages(chunks, import.PageCoverageJson);
        import.SelectedAlternativeId = selected?.Id ?? "";
        import.OutlineJson = Json.Write(chunks);
        import.DraftJson = Json.Write(new ImportDraft(ProgramTitle(selected?.Name ?? result.Outline.ProgramTitle, import.FileName),
            ImportNormalization.Text(selected?.Description ?? result.Outline.Description, 4000), []));
        import.Stage = "extract"; import.Status = ImportStatus.Pending; import.ChunksDone = 0; import.ChunksTotal = chunks.Count;
        import.UnresolvedCount = 0; import.CatalogStale = false;
    }

    public async Task<ImportView> SelectAlternative(Guid id, string alternativeId, CancellationToken ct)
    {
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            Validation.Require(import!.Status == ImportStatus.Pending && import.Stage == "select", "This import is not waiting for an alternative selection.", 409);
            var alternatives = string.IsNullOrWhiteSpace(import.AlternativesJson) ? [] : Json.Read<List<ImportAlternative>>(import.AlternativesJson);
            var selected = alternatives.SingleOrDefault(a => string.Equals(a.Id, alternativeId, StringComparison.OrdinalIgnoreCase));
            Validation.Require(selected is not null, "That alternative is no longer available. Read the outline again.", 409);
            var chunks = SplitChunks(selected!.Chunks ?? []);
            ValidateChunkPages(chunks, import.PageCoverageJson);
            import.SelectedAlternativeId = selected.Id; import.OutlineJson = Json.Write(chunks);
            import.DraftJson = Json.Write(new ImportDraft(ProgramTitle(selected.Name, import.FileName), ImportNormalization.Text(selected.Description, 4000), []));
            import.Stage = "extract"; import.ChunksDone = 0; import.ChunksTotal = chunks.Count; import.Revision++;
            await db.SaveChangesAsync(ct); await gate.Commit(ct);
        }
        db.ChangeTracker.Clear();
        return await Get(id, ct);
    }

    /// A program always has something to call itself on the review screen; the document's own
    /// file name is a better stand-in than a blank field when the model returns no title.
    private static string ProgramTitle(string? title, string fileName)
        => ImportNormalization.Label(title, 120, Path.GetFileNameWithoutExtension(fileName) is { Length: > 0 } name ? name : "Imported program");

    private static ImportChunk ToImportChunk(AiOutlineChunk chunk)
        => new(chunk.Label, chunk.Block, chunk.Phase, chunk.WeekFrom, chunk.WeekTo, chunk.PageFrom, chunk.PageTo, chunk.DayCount);

    /// One extraction pass over every section the import still owes. The sections are independent
    /// reads of different pages, so they are sent concurrently and merged afterwards in outline
    /// order: the draft is assembled exactly as if they had run one after another, but the import
    /// takes as long as its slowest section rather than the sum of all of them.
    ///
    /// An import whose outline never landed is resumed from the same stored text instead, so a
    /// retry continues the import rather than reporting a stage it can never leave.
    public async Task<ImportView> Extract(Guid id, CancellationToken ct)
    {
        var user = db.CurrentUser!.Value;
        List<ImportPageText>? outlinePages = null;
        var pending = new List<PendingChunk>();
        await using (var claim = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            // A duplicate delivery after the last chunk committed is already complete and is safe
            // to acknowledge without asking the model to read the document again.
            if (import!.Status == ImportStatus.Ready && import.Stage == "done")
            {
                await claim.Commit(ct);
                return await Get(id, ct);
            }
            var pages = SourcePages(import);
            if (import.Status == ImportStatus.Pending && import.Stage == "outline")
            {
                // The account lock is not reentrant, so the outline pass starts after this closes.
                outlinePages = pages;
                await claim.Commit(ct);
            }
            else
            {
                Validation.Require(import.Status == ImportStatus.Pending && import.Stage == "extract", "This import is not waiting for another extraction pass.", 409);
                var chunks = ReadChunks(import.OutlineJson);
                Validation.Require(import.ChunksDone < chunks.Count, "This import has already finished extracting.", 409);
                ValidateChunkPages(chunks.Skip(import.ChunksDone), import.PageCoverageJson);
                for (var index = import.ChunksDone; index < chunks.Count; index++)
                {
                    var chunk = chunks[index];
                    // A section the outline pointed at pages that carry no text — a photo spread, a
                    // scanned insert — has nothing to transcribe, so it costs no read and no budget.
                    var text = ImportSourceText.Slice(pages, chunk.PageFrom, chunk.PageTo);
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        // Every read is paid for up front. When the day's budget runs out partway,
                        // the sections already covered still run and the rest wait for tomorrow;
                        // only an import that can afford nothing at all is refused outright.
                        try { await Meter(import, ct); }
                        catch (DomainException) when (pending.Any(item => item.Text.Length > 0)) { break; }
                    }
                    pending.Add(new PendingChunk(index, chunk, text));
                }
                await db.SaveChangesAsync(ct);
                await claim.Commit(ct);
            }
        }
        db.ChangeTracker.Clear();
        if (outlinePages is not null) return await ReadOutline(id, outlinePages, ct);

        var results = new Dictionary<int, AiImportResult>();
        var failures = new Dictionary<int, DomainException>();
        var identifier = AuthService.Hash(user.ToString())[..32];
        // Concurrency is bounded so one import cannot open an unlimited number of provider
        // requests at once; a handful in flight is what turns the sum of the sections into the
        // longest of them.
        using (var inFlight = new SemaphoreSlim(Math.Max(1, config?.GetValue("OpenAi:MaxConcurrentChunks", 4) ?? 4)))
        {
            await Task.WhenAll(pending.Where(item => item.Text.Length > 0).Select(async item =>
            {
                await inFlight.WaitAsync(ct);
                try
                {
                    var result = await ai.ExtractChunk(item.Text, [], identifier, Directive(item.Chunk), ct);
                    lock (results) results[item.Index] = result;
                }
                catch (DomainException ex) { lock (failures) failures[item.Index] = ex; }
                catch (Exception) when (!ct.IsCancellationRequested)
                {
                    lock (failures) failures[item.Index] = new DomainException("That extraction chunk did not finish. Try again.", 503);
                }
                finally { inFlight.Release(); }
            }));
        }

        // The reads are paid for and complete: commit them even if the browser has since
        // disconnected. Sections merge in outline order and stop at the first one that failed, so
        // what is committed is always an unbroken prefix that a retry can continue from.
        var settle = CancellationToken.None;
        DomainException? stopped = null;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, settle))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, settle);
            if (import is not null && import.Status == ImportStatus.Pending && import.Stage == "extract")
            {
                var draft = Json.Read<ImportDraft>(import.DraftJson);
                foreach (var item in pending.OrderBy(item => item.Index))
                {
                    // Another delivery may have committed this same section while the model was
                    // reading. Its result is dropped instead of being merged a second time.
                    if (import.ChunksDone != item.Index) break;
                    if (failures.TryGetValue(item.Index, out var failure)) { stopped = failure; break; }
                    var complete = item.Index + 1 >= import.ChunksTotal;
                    try
                    {
                        // Everything that can reject a section runs before the row is touched, so a
                        // rejected section stays retryable instead of committing half of itself.
                        var notices = new List<ImportReviewIssue>();
                        var merged = draft;
                        if (item.Text.Length == 0)
                        {
                            notices.Add(new ImportReviewIssue("section_without_text",
                                $"'{item.Chunk.Label}' (PDF pages {item.Chunk.PageFrom}-{item.Chunk.PageTo}) has no selectable text and was skipped.",
                                "warning", item.Chunk.PageFrom));
                        }
                        else
                        {
                            var result = results[item.Index];
                            var extracted = await ToDraft(result.Program, settle);
                            var reconciled = ReconcileChunkCoverage(draft, extracted, item.Chunk);
                            notices.AddRange(reconciled.Notices);
                            merged = draft with
                            {
                                ProgramName = result.Program.ProgramTitle ?? result.Program.ProgramName ?? draft.ProgramName,
                                Description = result.Program.Description ?? draft.Description,
                                Workouts = [.. draft.Workouts, .. reconciled.Workouts]
                            };
                            import.Model = result.Model;
                            import.InputTokens += result.InputTokens; import.OutputTokens += result.OutputTokens;
                        }
                        if (complete)
                        {
                            // Every section has landed, so the phases are finally whole and their
                            // weeks can be numbered from one within each of them.
                            var numbered = NormalizePhaseWeeks(merged.Workouts);
                            if (numbered.Renumbered)
                            {
                                merged = merged with { Workouts = numbered.Workouts };
                                notices.Add(new ImportReviewIssue("phase_week_renumbered",
                                    "Some phases continued the block's week numbering, so their weeks were numbered from one within each phase. The weeks themselves are unchanged.",
                                    "warning", null));
                            }
                            // The whole draft is shaped again, not just this section's days: a day
                            // an earlier section committed before this ran is exactly the one that
                            // no retry of the last section could ever reach.
                            var shaped = ReconcileDayShape(merged.Workouts);
                            merged = merged with { Workouts = shaped.Workouts };
                            notices.AddRange(shaped.Notices);
                            await ValidateDraft(merged, settle);
                            ValidateDraftPages(merged, import.PageCoverageJson);
                        }
                        draft = merged;
                        AdvanceChunk(import, item.Index, notices);
                        if (complete)
                        {
                            import.Status = ImportStatus.Ready; import.Stage = "done";
                            UpdateCounters(import, draft);
                            ClearSource(import);
                        }
                    }
                    catch (DomainException ex) { stopped = ex; break; }
                }
                import.DraftJson = Json.Write(draft);
                await db.SaveChangesAsync(settle);
            }
            await gate.Commit(settle);
        }
        if (stopped is not null)
        {
            await RecordRetryableFailure(id, stopped.Message);
            throw stopped;
        }
        return await Get(id, ct);
    }

    /// What one section asks the model for. The outline's day count travels with it as an estimate
    /// rather than an instruction, because the pages themselves are the authority on how many days
    /// they document.
    private static string Directive(ImportChunk chunk)
        => $"Extract only chunk '{chunk.Label}', covering block '{chunk.Block}', phase '{chunk.Phase}', absolute weeks {chunk.WeekFrom}-{chunk.WeekTo}, pages {chunk.PageFrom}-{chunk.PageTo}. " +
           $"The outline estimated about {chunk.DayCount} days; return every day these pages actually document, and no days from other chunks.";

    /// One section waiting to be read, with the page text it covers. An empty text means the
    /// section's pages carry none, which is settled without a model call.
    private sealed record PendingChunk(int Index, ImportChunk Chunk, string Text);

    /// Retry is an explicit idempotent operation for a pending import; the stored text is reused
    /// while it is inside its retention window.
    public Task<ImportView> Retry(Guid id, CancellationToken ct) => Extract(id, ct);

    private static void AdvanceChunk(AiImport import, int chunkIndex, IReadOnlyList<ImportReviewIssue> recorded)
    {
        import.ChunksDone = chunkIndex + 1; import.Error = ""; import.Revision++;
        if (recorded.Count == 0) return;
        var notices = ReadNotices(import.NoticesJson);
        notices.AddRange(recorded);
        import.NoticesJson = Json.Write(notices.TakeLast(40).ToList());
    }

    private static List<ImportPageText> SourcePages(AiImport import)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(import.SourceTextJson),
            "The text read from this PDF has expired. Choose the same PDF again.", 410);
        return Json.Read<List<ImportPageText>>(import.SourceTextJson);
    }

    /// The extracted text exists only to finish the read. Once the draft is complete it has
    /// nothing left to say and is dropped rather than kept next to the draft it produced.
    private static void ClearSource(AiImport import)
    {
        import.SourceTextJson = ""; import.SourceExpiresAt = null;
    }

    private async Task FailImport(Guid importId, string message)
    {
        var settle = CancellationToken.None;
        db.ChangeTracker.Clear();
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, settle);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
        if (import is null || import.Status != ImportStatus.Pending) { await gate.Commit(settle); return; }
        // A failed import leaves nothing worth keeping. The reason travels back in the response
        // that reports it, so the row is removed instead of lingering in the list forever.
        db.Imports.Remove(import);
        await db.SaveChangesAsync(settle);
        await gate.Commit(settle);
    }

    /// Records a failure the same import can still recover from. The stored text stays, so the
    /// next attempt costs one model call rather than another read of the document.
    private async Task RecordRetryableFailure(Guid importId, string message)
    {
        var settle = CancellationToken.None;
        db.ChangeTracker.Clear();
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, settle);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
        if (import is null || import.Status != ImportStatus.Pending) { await gate.Commit(settle); return; }
        import.Error = message; import.Retries++; import.Revision++;
        await db.SaveChangesAsync(settle);
        await gate.Commit(settle);
    }

    /// The daily read budget. Every model call an import makes is metered, including retries.
    private async Task Meter(AiImport import, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var usage = await db.Usage.SingleOrDefaultAsync(u => u.Date == today, ct);
        if (usage == null) { usage = new AiUsage { UserId = db.CurrentUser!.Value, Date = today, Count = 0 }; db.Usage.Add(usage); }
        Validation.Require(usage.Count < DailyLimit, $"You have used all {DailyLimit} AI reads for today. Manual program building remains available.", 429);
        usage.Count++; import.Calls++;
        await db.SaveChangesAsync(ct);
    }
}
