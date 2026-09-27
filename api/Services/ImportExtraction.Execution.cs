using System.Text.Json;
using System.Collections.Concurrent;
using System.Diagnostics;
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
        List<ImportPageText> sourcePages = [];
        var sourceTextJson = "";
        var outlinePending = false;
        var totalChunks = 0;
        List<ImportChunk>? extractionChunks = null;
        var firstChunk = 0;
        var pageCoverageJson = "";
        List<ImportPageLink> demoLinks = [];
        var pending = new List<PendingChunk>();
        Dictionary<int, AiImportResult> persistedResults = [];
        Dictionary<int, int> persistedRecoveryReads = [];
        Dictionary<int, List<ImportRecoveryCandidate>> persistedRecoveryCandidates = [];
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
            totalChunks = import.ChunksTotal;
            if (LeaseHeldByAnother(import, leaseId, DateTime.UtcNow))
            {
                await claim.Commit(ct);
                db.ChangeTracker.Clear();
                return await Get(id, ct);
            }
            ClaimLease(import, leaseId, DateTime.UtcNow);
            Validation.Require(!string.IsNullOrWhiteSpace(import.SourceTextJson),
                "The text read from this PDF is no longer available.", 410);
            sourceTextJson = import.SourceTextJson;
            demoLinks = string.IsNullOrWhiteSpace(import.LinksJson) ? [] : Json.Read<List<ImportPageLink>>(import.LinksJson);
            if (import.Status == ImportStatus.Pending && import.Stage == "outline")
            {
                // The account lock is not reentrant, so the outline pass starts after this closes.
                outlinePending = true;
                import.Error = "";
                var outlineState = ImportWorkState.Read(import.WorkStateJson);
                import.WorkStateJson = Json.Write(outlineState with
                {
                    StartedAtUtc = outlineState.StartedAtUtc ?? DateTime.UtcNow,
                    LastProgressAtUtc = DateTime.UtcNow
                });
                import.Revision++;
                await db.SaveChangesAsync(ct);
                await claim.Commit(ct);
            }
            else
            {
                Validation.Require(import.Status == ImportStatus.Pending && import.Stage is "extract" or "verify" or "recover", "This import is not waiting for another extraction pass.", 409);
                // A process may have stopped during verification or a corrective read. Its
                // persisted chunk responses are either already complete or are replayed below;
                // restart the visible phase from the work still owed.
                import.Stage = "extract";
                import.Error = "";
                import.Revision++;
                var workState = ImportWorkState.Read(import.WorkStateJson);
                persistedRecoveryReads = workState.RecoveryReads ?? [];
                persistedRecoveryCandidates = workState.RecoveryCandidates ?? [];
                import.WorkStateJson = Json.Write(workState with
                {
                    StartedAtUtc = workState.StartedAtUtc ?? DateTime.UtcNow,
                    LastProgressAtUtc = DateTime.UtcNow,
                    SectionStages = []
                });
                var chunks = ReadChunks(import.OutlineJson);
                Validation.Require(import.ChunksDone < chunks.Count, "This import has already finished extracting.", 409);
                firstChunk = import.ChunksDone;
                pageCoverageJson = import.PageCoverageJson;
                extractionChunks = chunks;
                await db.SaveChangesAsync(ct);
                await claim.Commit(ct);
            }
        }
        db.ChangeTracker.Clear();
        sourcePages = Json.Read<List<ImportPageText>>(sourceTextJson);
        if (outlinePending) return await ReadOutline(id, sourcePages, ct, leaseId);
        var analysisTimer = Stopwatch.StartNew();
        var analysis = ImportSourceAnalysis.Create(sourcePages);
        logger?.LogInformation("Import source analysis completed in {ElapsedMilliseconds} ms for {PageCount} pages ({SourceCharacters} characters).",
            analysisTimer.ElapsedMilliseconds, analysis.Pages.Count, analysis.Pages.Sum(page => page.Text.Length));
        if (extractionChunks is not null)
        {
            ValidateChunkPages(extractionChunks.Skip(firstChunk), pageCoverageJson);
            var schedule = analysis.Schedule;
            var localReadTimer = Stopwatch.StartNew();
            var locallyReadPages = 0;
            for (var index = firstChunk; index < extractionChunks.Count; index++)
            {
                var chunk = extractionChunks[index];
                // A section the outline pointed at pages that carry no text — a photo spread, a
                // scanned insert — has nothing to transcribe, so it costs no read and no budget.
                var allText = analysis.Slice(chunk);
                var printed = schedule is null || string.IsNullOrWhiteSpace(allText) ? null
                    : ImportTableEvidence.ReadPrintedPages(schedule.Days, analysis.Tables, chunk.PageFrom, chunk.PageTo);
                var sectionPages = analysis.For(chunk).Select(page => page.Page).ToHashSet();
                var remainingPages = printed is null ? sectionPages : sectionPages.Except(printed.Pages).ToHashSet();
                var scheduledTrainingPages = schedule?.Days.Where(day => !day.IsRestDay
                        && day.Page >= chunk.PageFrom && day.Page <= chunk.PageTo)
                    .Select(day => day.Page).Distinct().ToHashSet() ?? [];
                // Divider-only pages add no transcription evidence when every complete printed
                // training page in this section was read locally.
                var text = printed is not null && scheduledTrainingPages.IsSubsetOf(printed.Pages)
                    ? ""
                    : printed is null ? allText : analysis.Slice(chunk, remainingPages);
                if (printed is not null)
                {
                    locallyReadPages += printed.Pages.Count;
                    pending.Add(new PendingChunk(index, chunk, text, printed.Program, printed.Pages));
                    continue;
                }
                if (!string.IsNullOrWhiteSpace(text) && !persistedResults.ContainsKey(index))
                {
                    // Every read is reserved before its request. If the daily budget runs out
                    // partway through, the covered sections still run and the rest wait for tomorrow.
                    try { await MeterInitialChunk(id, leaseId, ct); }
                    catch (DomainException) when (pending.Any(item => item.Text.Length > 0)) { break; }
                }
                pending.Add(new PendingChunk(index, chunk, text));
            }
            logger?.LogInformation("Import section preparation completed in {ElapsedMilliseconds} ms: {LocalPageCount} pages read locally, {ProviderSectionCount} sections need a provider read.",
                localReadTimer.ElapsedMilliseconds, locallyReadPages, pending.Count(item => item.Text.Length > 0 && !persistedResults.ContainsKey(item.Index)));
        }
        var sourceEvidence = analysis.Outline;
        var printedWeeks = analysis.PrintedWeeks;
        var preserveTrailingRestDays = analysis.PreserveTrailingRestDays;

        var results = persistedResults;
        foreach (var item in pending.Where(item => item.Printed is not null && item.Text.Length == 0))
            results[item.Index] = new AiImportResult(item.Printed!, PrintedTableReader, 0, 0);
        var completedThisPass = new HashSet<int>();
        var failures = new Dictionary<int, DomainException>();
        var leaseLost = false;
        var chunkStages = new ConcurrentDictionary<int, string>();
        var identifier = AuthService.Hash(user.ToString())[..32];
        // Concurrency is bounded so one import cannot open an unlimited number of provider
        // requests at once; a handful in flight is what turns the sum of the sections into the
        // longest of them. These are I/O waits, so widening the gate costs no extra CPU here and
        // no extra tokens — the real ceiling is the provider's per-minute allowance.
        using (var inFlight = new SemaphoreSlim(Math.Max(1, config?.GetValue("OpenAi:MaxConcurrentChunks", 8) ?? 8)))
        using (var persistGate = new SemaphoreSlim(1, 1))
        {
            async Task UpdateChunkStage(int index, string? stage)
            {
                if (stage is null) chunkStages.TryRemove(index, out _);
                else chunkStages[index] = stage;
                var persisted = await PersistProgressStage(id, leaseId, persistGate,
                    () => chunkStages.Values.Contains("extract") ? "extract"
                        : chunkStages.Values.Contains("recover") ? "recover"
                        : chunkStages.Values.Contains("verify") ? "verify" : "extract", chunkStages, CancellationToken.None);
                if (!persisted) leaseLost = true;
            }

            await Task.WhenAll(pending.Where(item => item.Text.Length > 0
                    && (!results.ContainsKey(item.Index) || persistedRecoveryCandidates.ContainsKey(item.Index)))
                .Select(async item =>
            {
                await inFlight.WaitAsync(ct);
                try
                {
                    var candidates = persistedRecoveryCandidates.GetValueOrDefault(item.Index)?.ToList() ?? [];
                    var chunkPages = analysis.For(item.Chunk).ToList();
                    var printedDays = analysis.DayLabels.Where(label => label.Key >= item.Chunk.PageFrom && label.Key <= item.Chunk.PageTo)
                        .Sum(label => label.Value.Count);
                    var scored = new List<(ImportRecoveryCandidate Candidate, ImportVerificationFinding Finding)>();
                    async Task ScoreAndRecord(ImportRecoveryCandidate candidate)
                    {
                        ImportVerificationFinding finding;
                        var verificationTimer = Stopwatch.StartNew();
                        await persistGate.WaitAsync(ct);
                        try { finding = await RecoveryScore(candidate.Response, chunkPages, printedDays, analysis, ct); }
                        finally { persistGate.Release(); }
                        logger?.LogInformation("Import section verification completed in {ElapsedMilliseconds} ms for section {SectionIndex}, attempt {Attempt}: score {Score}, repair reasons {RepairReasons}, targeted {Targeted}.",
                            verificationTimer.ElapsedMilliseconds, item.Index + 1, candidate.Attempt,
                            finding.Score, string.Join(",", finding.RepairReasons), finding.TargetedRepair);
                        if (!await PersistRecoveryReasons(id, item.Index, leaseId, candidate.Attempt,
                            finding.RepairReasons, persistGate, CancellationToken.None))
                            leaseLost = true;
                        scored.Add((candidate, finding));
                    }

                    if (candidates.Count == 0)
                    {
                        await UpdateChunkStage(item.Index, "extract");
                        var extracted = await ai.ExtractChunk(item.Text, [], identifier, Directive(item.Chunk), ct, analysis.Tables);
                        var response = extracted with { Program = MergePrintedPages(extracted.Program, item.Printed, item.PrintedPages) };
                        var candidate = new ImportRecoveryCandidate(0, response, DateTime.UtcNow);
                        if (!await PersistRecoveryCandidate(id, item.Index, leaseId, 0, response, persistGate, CancellationToken.None))
                        {
                            leaseLost = true;
                            return;
                        }
                        candidates.Add(candidate);
                        await UpdateChunkStage(item.Index, "verify");
                        await ScoreAndRecord(candidate);
                    }
                    else
                    {
                        await UpdateChunkStage(item.Index, "verify");
                        foreach (var candidate in candidates.OrderBy(candidate => candidate.Attempt))
                            await ScoreAndRecord(candidate);
                    }

                    if (leaseLost) return;
                    var best = scored.OrderBy(item => item.Finding.Score).ThenBy(item => item.Candidate.Attempt).First();
                    var last = scored.OrderBy(item => item.Candidate.Attempt).Last();
                    var alreadyRead = persistedRecoveryReads.GetValueOrDefault(item.Index);
                    var mayRepair = candidates.Count == 1 || last.Finding.Score < best.Finding.Score;
                    while (alreadyRead < 2 && best.Finding.CanRecover && mayRepair)
                    {
                        var attempt = await TryReserveRecoveryRead(id, item.Index, leaseId, persistGate, ct);
                        if (attempt is null) break;
                        alreadyRead = attempt.Value;
                        await UpdateChunkStage(item.Index, "recover");
                        try
                        {
                            var scopePages = best.Finding.TargetedRepair
                                ? best.Finding.RepairPages.ToHashSet() : null;
                            var repairText = scopePages is { Count: > 0 }
                                ? analysis.Slice(item.Chunk, scopePages)
                                : item.Text;
                            var repairDirective = scopePages is { Count: > 0 }
                                ? $"Correct only the complete printed day groups on PDF page{(scopePages.Count == 1 ? "" : "s")} {string.Join(", ", scopePages.Order())}. Return complete replacement days for those pages only, with a sourcePage on every day. Preserve every exercise row, set count, prescription, note, alternative, and rest exactly as printed; do not return days from other pages. If the source is ambiguous, preserve the ambiguity instead of guessing."
                                : Directive(item.Chunk) + " Compare every printed day label, exercise row, set row, and prescription cell with the prior extraction. Resolve source-supported omissions and extras only from the printed source; preserve ambiguity instead of guessing.";
                            var recovered = await ai.ExtractChunk(repairText, [], identifier,
                                repairDirective + $" Verification pass {attempt} of 2.", ct, analysis.Tables);
                            var repairedProgram = scopePages is { Count: > 0 }
                                ? ReplacePageScope(best.Candidate.Response.Program, recovered.Program, scopePages)
                                : MergePrintedPages(recovered.Program, item.Printed, item.PrintedPages);
                            recovered = recovered with { Program = repairedProgram };
                            var candidate = new ImportRecoveryCandidate(attempt.Value, recovered, DateTime.UtcNow);
                            if (!await PersistRecoveryCandidate(id, item.Index, leaseId, attempt.Value, recovered, persistGate, CancellationToken.None))
                            {
                                leaseLost = true;
                                return;
                            }
                            candidates.Add(candidate);
                            await UpdateChunkStage(item.Index, "verify");
                            await ScoreAndRecord(candidate);
                            var recoveredFinding = scored[^1].Finding;
                            if (recoveredFinding.Score < best.Finding.Score)
                            {
                                best = (candidate, recoveredFinding);
                                mayRepair = true;
                            }
                            else { mayRepair = false; break; }
                        }
                        catch (DomainException)
                        {
                            // A reserved but failed call consumes one of the two durable attempts.
                            mayRepair = false;
                            break;
                        }
                    }
                    if (leaseLost) return;
                    var totalInputTokens = candidates.Sum(candidate => candidate.Response.InputTokens);
                    var totalOutputTokens = candidates.Sum(candidate => candidate.Response.OutputTokens);
                    var totalCachedInputTokens = candidates.Sum(candidate => candidate.Response.CachedInputTokens);
                    var result = new AiImportResult(best.Candidate.Response.Program, best.Candidate.Response.Model,
                        totalInputTokens, totalOutputTokens, totalCachedInputTokens);
                    if (!await PersistFinalChunkResult(id, item.Index, leaseId, result, persistGate, CancellationToken.None))
                    {
                        leaseLost = true;
                        return;
                    }
                    lock (results)
                    {
                        results[item.Index] = result;
                        completedThisPass.Add(item.Index);
                    }
                }
                catch (DomainException ex) { lock (failures) failures[item.Index] = ex; }
                catch (Exception) when (!ct.IsCancellationRequested)
                {
                    lock (failures) failures[item.Index] = new DomainException("That extraction chunk did not finish. Try again.", 503);
                }
                finally
                {
                    try { await UpdateChunkStage(item.Index, null); }
                    finally { inFlight.Release(); }
                }
            }));
        }

        // All provider work for this pass has settled. Ordered reconciliation and persistence
        // are a separate phase, so the status must stop claiming that a read is still underway.
        if (!leaseLost)
        {
            using var progressGate = new SemaphoreSlim(1, 1);
            var reachedEnd = pending.Count > 0 && pending[^1].Index == totalChunks - 1 && failures.Count == 0;
            await PersistProgressStage(id, leaseId, progressGate, () => reachedEnd ? "verify" : "extract",
                chunkStages, CancellationToken.None);
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
            if (import is not null && import.Status == ImportStatus.Pending && (import.Stage is "extract" or "verify")
                && OwnsLease(import, leaseId) && !leaseLost)
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
                        if (item.Index == pending[0].Index && pending.Count(other => other.Printed is not null && other.Text.Length == 0) is var local and > 0)
                            notices.Add(new ImportReviewIssue("printed_sections_read",
                                $"{local} of {pending.Count} section{(pending.Count == 1 ? " was" : "s were")} read straight from clean printed tables, without a model read.", "info"));
                        if (item.Index == pending[0].Index)
                        {
                            var localPages = pending.SelectMany(other => other.PrintedPages ?? []).Distinct().Order().ToList();
                            if (localPages.Count > 0)
                                notices.Add(new ImportReviewIssue("printed_pages_read",
                                    $"{localPages.Count} complete page group{(localPages.Count == 1 ? " was" : "s were")} read from clean printed tables on PDF pages {string.Join(", ", localPages)}.",
                                    "info", localPages[0]));
                        }
                        var merged = draft;
                        if (item.Text.Length == 0 && item.Printed is null)
                        {
                            notices.Add(new ImportReviewIssue("section_without_text",
                                $"'{item.Chunk.Label}' (PDF pages {item.Chunk.PageFrom}-{item.Chunk.PageTo}) has no selectable text and was skipped.",
                                "info", item.Chunk.PageFrom));
                        }
                        else
                        {
                            var result = results[item.Index];
                            var chunkPages = sourcePages.Where(page => page.Page >= item.Chunk.PageFrom && page.Page <= item.Chunk.PageTo).ToList();
                            var sourceEnriched = ImportTableEvidence.Enrich(result.Program, analysis.Tables);
                            var labeled = ImportDayLabels.Apply(await ToDraft(sourceEnriched, settle), chunkPages);
                            notices.AddRange(labeled.Notices);
                            var extracted = ImportOutlineEvidence.NormalizeDraft(labeled.Draft, sourceEvidence);
                            var reconciled = ReconcileChunkCoverage(draft, extracted, item.Chunk, chunkPages,
                                preserveTrailingRestDays, printedWeeks);
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
                            var finalizationTimer = Stopwatch.StartNew();
                            merged = FinalizeDraft(merged, analysis, import, notices);
                            await ValidateDraft(merged, settle);
                            ValidateDraftPages(merged, import.PageCoverageJson);
                            logger?.LogInformation("Import final source reconciliation completed in {ElapsedMilliseconds} ms across {WorkoutCount} workouts.",
                                finalizationTimer.ElapsedMilliseconds, merged.Workouts.Count);
                            // Keep the full source-reconciled draft available if final verification
                            // finds an irreducible source ambiguity. The import still fails closed,
                            // but its terminal explanation can show the material the reader did resolve.
                            draft = merged;
                            // Week variants are held as adjacent temporary weeks so either can be
                            // selected after the full read. Gaps across those temporary slots are
                            // checked on the selected branch, where they have their real numbering.
                            var weekVersionChoicePending = ImportWeekChoice.Offer(merged, sourcePages,
                                analysis.WeekVersions.ToDictionary(item => item.Key, item => item.Value)).Count > 1;
                            RequireVerifiedDraft(merged, import, notices, weekVersionChoicePending);
                        }
                        draft = merged;
                        AdvanceChunk(import, item.Index, notices);
                        if (complete)
                        {
                            CompleteRead(import, draft, sourcePages,
                                analysis.WeekVersions.ToDictionary(item => item.Key, item => item.Value));
                            // Week-version selection is part of verification. Keep its source
                            // evidence until the selected branch has passed the final checks.
                            if (import.Status != ImportStatus.Pending || import.Stage != "select") ClearSource(import);
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
            if (stopped is ImportVerificationException verification)
                await FailImport(id, stopped.Message, leaseId, "source_verification_failed",
                    verification.Issue);
            else await RecordRetryableFailure(id, stopped.Message, leaseId);
            throw stopped;
        }
        return await Get(id, ct);
    }

}
