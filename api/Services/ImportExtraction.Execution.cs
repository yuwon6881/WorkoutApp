using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
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
        var leaseId = NewLeaseId();
        List<ImportPageText>? outlinePages = null;
        List<ImportPageText> sourcePages = [];
        List<ImportPageLink> demoLinks = [];
        var pending = new List<PendingChunk>();
        Dictionary<int, AiImportResult> persistedResults = [];
        await using (var claim = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            persistedResults = ReadChunkResults(import!.ChunkResultsJson);
            // A duplicate delivery after the last chunk committed is already complete and is safe
            // to acknowledge without asking the model to read the document again.
            if (import!.Status == ImportStatus.Ready && import.Stage == "done")
            {
                await claim.Commit(ct);
                return await Get(id, ct);
            }
            Validation.Require(import.Status != ImportStatus.Pending || import.PromptVersion == WorkoutAi.PromptVersion,
                "This PDF import was created by an older importer. Upload the PDF again to continue with the updated reader.", 409);
            if (LeaseHeldByAnother(import, leaseId, DateTime.UtcNow))
            {
                await claim.Commit(ct);
                db.ChangeTracker.Clear();
                return await Get(id, ct);
            }
            ClaimLease(import, leaseId, DateTime.UtcNow);
            var pages = SourcePages(import);
            sourcePages = pages;
            demoLinks = string.IsNullOrWhiteSpace(import.LinksJson) ? [] : Json.Read<List<ImportPageLink>>(import.LinksJson);
            if (import.Status == ImportStatus.Pending && import.Stage == "outline")
            {
                // The account lock is not reentrant, so the outline pass starts after this closes.
                outlinePages = pages;
                import.Error = "";
                import.Revision++;
                await db.SaveChangesAsync(ct);
                await claim.Commit(ct);
            }
            else
            {
                Validation.Require(import.Status == ImportStatus.Pending && import.Stage == "extract", "This import is not waiting for another extraction pass.", 409);
                import.Error = "";
                import.Revision++;
                var chunks = ReadChunks(import.OutlineJson);
                Validation.Require(import.ChunksDone < chunks.Count, "This import has already finished extracting.", 409);
                ValidateChunkPages(chunks.Skip(import.ChunksDone), import.PageCoverageJson);
                for (var index = import.ChunksDone; index < chunks.Count; index++)
                {
                    var chunk = chunks[index];
                    // A section the outline pointed at pages that carry no text — a photo spread, a
                    // scanned insert — has nothing to transcribe, so it costs no read and no budget.
                    var text = ImportSourceText.Slice(pages, chunk.PageFrom, chunk.PageTo);
                    if (!string.IsNullOrWhiteSpace(text) && !persistedResults.ContainsKey(index))
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
        if (outlinePages is not null) return await ReadOutline(id, outlinePages, ct, leaseId);
        var sourceEvidence = ImportOutlineEvidence.Read(sourcePages);

        var results = persistedResults;
        var completedThisPass = new HashSet<int>();
        var failures = new Dictionary<int, DomainException>();
        var leaseLost = false;
        var identifier = AuthService.Hash(user.ToString())[..32];
        // Concurrency is bounded so one import cannot open an unlimited number of provider
        // requests at once; a handful in flight is what turns the sum of the sections into the
        // longest of them. These are I/O waits, so widening the gate costs no extra CPU here and
        // no extra tokens — the real ceiling is the provider's per-minute allowance.
        using (var inFlight = new SemaphoreSlim(Math.Max(1, config?.GetValue("OpenAi:MaxConcurrentChunks", 8) ?? 8)))
        using (var persistGate = new SemaphoreSlim(1, 1))
        {
            await Task.WhenAll(pending.Where(item => item.Text.Length > 0 && !results.ContainsKey(item.Index)).Select(async item =>
            {
                await inFlight.WaitAsync(ct);
                try
                {
                    var result = await ai.ExtractChunk(item.Text, [], identifier, Directive(item.Chunk), ct);
                    lock (results)
                    {
                        results[item.Index] = result;
                        completedThisPass.Add(item.Index);
                    }

                    await persistGate.WaitAsync(CancellationToken.None);
                    try
                    {
                        await using var resultGate = await MutationLock.Acquire(db, db.CurrentUser, CancellationToken.None);
                        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, CancellationToken.None);
                        if (import is not null && import.Status == ImportStatus.Pending && OwnsLease(import, leaseId))
                        {
                            var stored = ReadChunkResults(import.ChunkResultsJson);
                            stored[item.Index] = result;
                            import.ChunkResultsJson = Json.Write(stored);
                            import.Model = result.Model;
                            import.InputTokens += result.InputTokens;
                            import.CachedInputTokens += result.CachedInputTokens;
                            import.OutputTokens += result.OutputTokens;
                            RenewLease(import);
                            import.Revision++;
                            await db.SaveChangesAsync(CancellationToken.None);
                        }
                        else if (import is not null && !OwnsLease(import, leaseId)) leaseLost = true;
                        await resultGate.Commit(CancellationToken.None);
                    }
                    finally { persistGate.Release(); }
                }
                catch (DomainException ex) { lock (failures) failures[item.Index] = ex; }
                catch (Exception) when (!ct.IsCancellationRequested)
                {
                    lock (failures) failures[item.Index] = new DomainException("That extraction chunk did not finish. Try again.", 503);
                }
                finally { inFlight.Release(); }
            }));
        }

        // Persist any remaining successful provider responses before attempting ordered draft
        // assembly. If the first section failed, later paid sections are now
        // durable and can be reused on the next retry.
        if (completedThisPass.Count > 0 && !leaseLost)
        {
            await using var resultGate = await MutationLock.Acquire(db, db.CurrentUser, CancellationToken.None);
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, CancellationToken.None);
            if (import is not null && import.Status == ImportStatus.Pending && OwnsLease(import, leaseId))
            {
                var stored = ReadChunkResults(import.ChunkResultsJson);
                var changed = false;
                foreach (var index in completedThisPass)
                {
                    if (results.TryGetValue(index, out var result) && !stored.ContainsKey(index))
                    {
                        stored[index] = result;
                        import.Model = result.Model;
                        import.InputTokens += result.InputTokens;
                        import.CachedInputTokens += result.CachedInputTokens;
                        import.OutputTokens += result.OutputTokens;
                        changed = true;
                    }
                }
                if (changed)
                {
                    import.ChunkResultsJson = Json.Write(stored);
                    RenewLease(import);
                    import.Revision++;
                    await db.SaveChangesAsync(CancellationToken.None);
                }
            }
            else if (import is not null && !OwnsLease(import, leaseId)) leaseLost = true;
            await resultGate.Commit(CancellationToken.None);
        }

        // The reads are paid for and complete: commit them even if the browser has since
        // disconnected. Sections merge in outline order and stop at the first one that failed, so
        // what is committed is always an unbroken prefix that a retry can continue from.
        var settle = CancellationToken.None;
        DomainException? stopped = null;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, settle))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, settle);
            if (import is not null && import.Status == ImportStatus.Pending && import.Stage == "extract" && OwnsLease(import, leaseId) && !leaseLost)
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
                            var chunkPages = sourcePages.Where(page => page.Page >= item.Chunk.PageFrom && page.Page <= item.Chunk.PageTo).ToList();
                            var labeled = ImportDayLabels.Apply(await ToDraft(result.Program, settle), chunkPages);
                            notices.AddRange(labeled.Notices);
                            var extracted = ImportOutlineEvidence.NormalizeDraft(labeled.Draft, sourceEvidence);
                            var reconciled = ReconcileChunkCoverage(draft, extracted, item.Chunk, chunkPages);
                            notices.AddRange(reconciled.Notices);
                            // Checked per section rather than against the whole document: a name
                            // belongs to the pages it was read from, and a movement printed in a
                            // later block is no evidence for a section that never saw it.
                            var section = ImportDemoLinks.Attach(
                                extracted with { Workouts = reconciled.Workouts }, demoLinks);
                            notices.AddRange(ImportNameEvidence.Unsupported(section, chunkPages));
                            notices.AddRange(ImportNameEvidence.OverCounted(section, chunkPages));
                            merged = draft with
                            {
                                // The outline pass reads the whole document and owns its title. A section
                                // answers only for the pages it was handed, so it reports the block heading
                                // printed over those pages: letting the last section win renamed the program
                                // after whichever block happened to be read last.
                                ProgramName = string.IsNullOrWhiteSpace(draft.ProgramName)
                                    ? ImportNormalization.Text(result.Program.ProgramTitle ?? result.Program.ProgramName, 120) ?? draft.ProgramName
                                    : draft.ProgramName,
                                Workouts = [.. draft.Workouts, .. section.Workouts]
                            };
                        }
                        if (complete)
                        {
                            // A week whose lettered versions landed in different sections is
                            // only whole now, so it is separated again over the whole draft.
                            var versions = ImportWeekVariants.Separate(merged.Workouts, sourcePages);
                            merged = merged with { Workouts = versions.Workouts };
                            notices.AddRange(versions.Notices);
                            var blockRuns = ImportBlockRuns.Reconcile(merged.Workouts);
                            merged = merged with { Workouts = blockRuns.Workouts };
                            notices.AddRange(blockRuns.Notices);
                            var named = ImportDayLabels.FillMissing(merged);
                            merged = named.Draft;
                            notices.AddRange(named.Notices);
                            // Every section has landed, so the phases are finally whole and their
                            // weeks can be numbered from one within each of them.
                            var numbered = NormalizePhaseWeeks(merged.Workouts);
                            if (numbered.Renumbered)
                            {
                                merged = merged with { Workouts = numbered.Workouts };
                                notices.Add(new ImportReviewIssue("phase_week_renumbered",
                                    "Some phases continued the block's week numbering, so their weeks were numbered from one within each phase. The weeks themselves are unchanged.",
                                    "info", null));
                            }
                            var longWeeks = ImportLongWeeks.Reconcile(merged.Workouts, sourcePages);
                            merged = merged with { Workouts = longWeeks.Workouts };
                            notices.AddRange(longWeeks.Notices);
                            // The whole draft is shaped again, not just this section's days: a day
                            // an earlier section committed before this ran is exactly the one that
                            // no retry of the last section could ever reach.
                            var shaped = ReconcileDayShape(merged.Workouts);
                            var cited = ImportDayShape.ReconcilePages(merged with { Workouts = shaped.Workouts }, import.Pages);
                            merged = ImportValidation.NormalizeDraft(cited.Draft);
                            notices.AddRange(shaped.Notices);
                            notices.AddRange(cited.Notices);
                            await ValidateDraft(merged, settle);
                            ValidateDraftPages(merged, import.PageCoverageJson);
                        }
                        draft = merged;
                        AdvanceChunk(import, item.Index, notices);
                        if (complete)
                        {
                            import.Status = ImportStatus.Ready; import.Stage = "done";
                            import.DraftBaselineJson = Json.Write(draft);
                            UpdateCounters(import, draft);
                            ClearSource(import);
                        }
                    }
                    catch (DomainException ex) { stopped = ex; break; }
                }
                import.DraftJson = Json.Write(draft);
                if (stopped is null) ReleaseLease(import);
                await db.SaveChangesAsync(settle);
            }
            await gate.Commit(settle);
        }
        if (stopped is not null)
        {
            await RecordRetryableFailure(id, stopped.Message, leaseId);
            throw stopped;
        }
        return await Get(id, ct);
    }

    /// Runs the synchronous extraction path from an owned background scope. HTTP callers use the
    /// runner, while direct callers and tests can still await Extract deterministically.
    public async Task RunExtract(Guid id, CancellationToken ct)
    {
        try
        {
            await Extract(id, ct);
        }
        catch (DomainException ex)
        {
            await RecordBackgroundFailure(id, ex.Message);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            await RecordBackgroundFailure(id, "That extraction did not finish. Try again.");
        }
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
        var notices = ImportReviewNotices.Merge(ReadNotices(import.NoticesJson), recorded);
        import.NoticesJson = Json.Write(notices);
    }

    private static List<ImportPageText> SourcePages(AiImport import)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(import.SourceTextJson),
            "The text read from this PDF is no longer available.", 410);
        return Json.Read<List<ImportPageText>>(import.SourceTextJson);
    }

    /// The extracted text exists only to finish the read. Once the draft is complete it has
    /// nothing left to say and is dropped rather than kept next to the draft it produced.
    private static void ClearSource(AiImport import)
    {
        import.SourceTextJson = ""; import.LinksJson = ""; import.SourceExpiresAt = null; import.ChunkResultsJson = "";
    }

    private static Dictionary<int, AiImportResult> ReadChunkResults(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return Json.Read<Dictionary<int, AiImportResult>>(json); }
        catch (JsonException) { return []; }
        catch (DomainException) { return []; }
    }

    private async Task FailImport(Guid importId, string message, string? leaseId = null)
    {
        var settle = CancellationToken.None;
        db.ChangeTracker.Clear();
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, settle);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
        if (import is null || import.Status != ImportStatus.Pending || (leaseId is not null && !OwnsLease(import, leaseId))) { await gate.Commit(settle); return; }
        // A failed import leaves nothing worth keeping. The reason travels back in the response
        // that reports it, so the row is removed instead of lingering in the list forever.
        db.Imports.Remove(import);
        await db.SaveChangesAsync(settle);
        await gate.Commit(settle);
    }

    /// Records a failure the same import can still recover from. The stored text stays, so the
    /// next attempt costs one model call rather than another read of the document.
    private async Task RecordRetryableFailure(Guid importId, string message, string? leaseId = null)
    {
        var settle = CancellationToken.None;
        db.ChangeTracker.Clear();
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, settle);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
        if (import is null || import.Status != ImportStatus.Pending || (leaseId is not null && !OwnsLease(import, leaseId))) { await gate.Commit(settle); return; }
        import.Error = message; import.Retries++; import.Revision++; ReleaseLease(import);
        await db.SaveChangesAsync(settle);
        await gate.Commit(settle);
    }

    private async Task RecordBackgroundFailure(Guid importId, string message)
    {
        var settle = CancellationToken.None;
        db.ChangeTracker.Clear();
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, settle);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
        if (import is not null && import.Status == ImportStatus.Pending && string.IsNullOrWhiteSpace(import.Error))
        {
            import.Error = message; import.Retries++; import.Revision++;
            await db.SaveChangesAsync(settle);
        }
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
