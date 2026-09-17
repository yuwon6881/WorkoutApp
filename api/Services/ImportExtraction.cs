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
            import.AlternativesJson = Json.Write(alternatives.Select(a => new ImportAlternative(a.Id, a.Name, a.Description,
                a.Chunks.Count, a.Chunks.Sum(c => c.DayCount), a.Chunks.Select(ToImportChunk).ToList())).ToList());
            import.Stage = "select"; import.Status = ImportStatus.Pending; import.ChunksDone = 0; import.ChunksTotal = 0;
            import.DraftJson = Json.Write(new ImportDraft(result.Outline.ProgramTitle, result.Outline.Description, []));
            return;
        }
        var selected = alternatives.Count == 1 ? alternatives[0] : null;
        var chunks = SplitChunks((selected?.Chunks ?? result.Outline.Chunks).Select(c => c with { }).ToList());
        ValidateChunkPages(chunks, import.PageCoverageJson);
        import.SelectedAlternativeId = selected?.Id ?? "";
        import.OutlineJson = Json.Write(chunks);
        import.DraftJson = Json.Write(new ImportDraft(selected?.Name ?? result.Outline.ProgramTitle, selected?.Description ?? result.Outline.Description, []));
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
            import.DraftJson = Json.Write(new ImportDraft(selected.Name, selected.Description, []));
            import.Stage = "extract"; import.ChunksDone = 0; import.ChunksTotal = chunks.Count; import.Revision++;
            await db.SaveChangesAsync(ct); await gate.Commit(ct);
        }
        db.ChangeTracker.Clear();
        return await Get(id, ct);
    }

    private static ImportChunk ToImportChunk(AiOutlineChunk chunk)
        => new(chunk.Label, chunk.Block, chunk.Phase, chunk.WeekFrom, chunk.WeekTo, chunk.PageFrom, chunk.PageTo, chunk.DayCount);

    /// One extraction pass over the pages of the next outline chunk. An import whose outline never
    /// landed is resumed from the same stored text, so a retry continues the import rather than
    /// reporting a stage it can never leave.
    public async Task<ImportView> Extract(Guid id, CancellationToken ct)
    {
        var user = db.CurrentUser!.Value;
        ImportChunk chunk = default!;
        var chunkIndex = 0;
        var chunkText = "";
        var skipped = false;
        List<ImportPageText>? outlinePages = null;
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
                chunkIndex = import.ChunksDone;
                chunk = chunks[chunkIndex];
                ValidateChunkPages([chunk], import.PageCoverageJson);
                chunkText = ImportSourceText.Slice(pages, chunk.PageFrom, chunk.PageTo);
                // A section the outline pointed at pages that carry no text — a photo spread, a
                // scanned insert — has nothing to transcribe. Skipping it with a visible note is
                // honest and lets the rest of the program finish; failing would strand the import.
                if (string.IsNullOrWhiteSpace(chunkText))
                {
                    AdvanceChunk(import, chunkIndex, new ImportReviewIssue("section_without_text",
                        $"'{chunk.Label}' (PDF pages {chunk.PageFrom}-{chunk.PageTo}) has no selectable text and was skipped.", "warning", chunk.PageFrom));
                    await db.SaveChangesAsync(ct);
                    await claim.Commit(ct);
                    skipped = true;
                }
                else
                {
                    await Meter(import, ct);
                    await db.SaveChangesAsync(ct);
                    await claim.Commit(ct);
                }
            }
        }
        db.ChangeTracker.Clear();
        if (outlinePages is not null) return await ReadOutline(id, outlinePages, ct);
        if (skipped)
        {
            // The account lock is not reentrant, so the import is completed after that gate closed.
            try { await FinishIfComplete(id, ct); }
            catch (DomainException ex) { await RecordRetryableFailure(id, ex.Message); throw; }
            return await Get(id, ct);
        }

        AiImportResult result;
        try
        {
            result = await ai.ExtractChunk(chunkText, [], AuthService.Hash(user.ToString())[..32],
                $"Extract only chunk '{chunk.Label}', covering block '{chunk.Block}', phase '{chunk.Phase}', absolute weeks {chunk.WeekFrom}-{chunk.WeekTo}, pages {chunk.PageFrom}-{chunk.PageTo}. " +
                $"The outline estimated about {chunk.DayCount} days; return every day these pages actually document, and no days from other chunks.", ct);
        }
        catch (DomainException ex)
        {
            await RecordRetryableFailure(id, ex.Message);
            throw;
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            await RecordRetryableFailure(id, "That extraction chunk did not finish. Try again.");
            throw;
        }

        var settle = CancellationToken.None;
        DomainException? rejected = null;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, settle))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, settle);
            // Another delivery may have committed this same chunk while the model was reading.
            // The duplicate result is dropped instead of being merged a second time.
            if (import is not null && import.Status == ImportStatus.Pending && import.Stage == "extract" && import.ChunksDone == chunkIndex)
            {
                var existing = Json.Read<ImportDraft>(import.DraftJson);
                var complete = chunkIndex + 1 >= import.ChunksTotal;
                try
                {
                    // Everything that can reject this result runs before the row is touched, so a
                    // rejected chunk stays retryable instead of committing a half-applied import.
                    var extracted = await ToDraft(result.Program, settle);
                    var reconciled = ReconcileChunkCoverage(existing, extracted, chunk);
                    var merged = existing with
                    {
                        ProgramName = result.Program.ProgramTitle ?? result.Program.ProgramName ?? existing.ProgramName,
                        Description = result.Program.Description ?? existing.Description,
                        Workouts = [.. existing.Workouts, .. extracted.Workouts]
                    };
                    if (complete)
                    {
                        await ValidateDraft(merged, settle);
                        ValidateDraftPages(merged, import.PageCoverageJson);
                    }
                    import.DraftJson = Json.Write(merged); import.Model = result.Model;
                    import.InputTokens += result.InputTokens; import.OutputTokens += result.OutputTokens;
                    AdvanceChunk(import, chunkIndex, reconciled);
                    if (complete)
                    {
                        import.Status = ImportStatus.Ready; import.Stage = "done"; UpdateCounters(import, merged);
                        ClearSource(import);
                    }
                    await db.SaveChangesAsync(settle);
                }
                catch (DomainException ex)
                {
                    db.ChangeTracker.Clear();
                    rejected = ex;
                }
            }
            await gate.Commit(settle);
        }
        if (rejected is not null)
        {
            await RecordRetryableFailure(id, rejected.Message);
            throw rejected;
        }
        return await Get(id, ct);
    }

    /// Marks an import ready once every outline chunk has been accounted for, whether it was
    /// extracted or skipped for having no text. Returns false when chunks remain.
    private async Task<bool> FinishIfComplete(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        if (import is null || import.Status != ImportStatus.Pending || import.Stage != "extract" || import.ChunksDone < import.ChunksTotal)
        {
            await gate.Commit(ct);
            return false;
        }
        var draft = Json.Read<ImportDraft>(import.DraftJson);
        await ValidateDraft(draft, ct);
        ValidateDraftPages(draft, import.PageCoverageJson);
        import.Status = ImportStatus.Ready; import.Stage = "done"; import.Revision++;
        UpdateCounters(import, draft);
        ClearSource(import);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return true;
    }

    /// Retry is an explicit idempotent operation for a pending import; the stored text is reused
    /// while it is inside its retention window.
    public Task<ImportView> Retry(Guid id, CancellationToken ct) => Extract(id, ct);

    private static void AdvanceChunk(AiImport import, int chunkIndex, ImportReviewIssue? notice)
    {
        import.ChunksDone = chunkIndex + 1; import.Error = ""; import.Revision++;
        if (notice is null) return;
        var notices = ReadNotices(import.NoticesJson);
        notices.Add(notice);
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
