using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

internal sealed record ImportVerificationFinding(int Score, int MissingOrExtraDays, int UnsupportedExercises,
    int RepeatedExercises, int UnreadPrescriptions, List<int> RepairPages, bool TargetedRepair)
{
    public bool CanRecover => MissingOrExtraDays > 0 || UnsupportedExercises > 0
        || RepeatedExercises > 0 || UnreadPrescriptions > 0;

    public List<string> RepairReasons
    {
        get
        {
            var reasons = new List<string>();
            if (MissingOrExtraDays > 0) reasons.Add("day_count_mismatch");
            if (UnsupportedExercises > 0) reasons.Add("exercise_not_in_source");
            if (RepeatedExercises > 0) reasons.Add("exercise_repeated_beyond_source");
            if (UnreadPrescriptions > 0) reasons.Add("printed_prescription_unread");
            return reasons;
        }
    }
}

public sealed partial class ImportService
{
    /// What one section asks the model for. The outline's day count travels with it as an estimate
    /// rather than an instruction, because the pages themselves are the authority on how many days
    /// they document.
    private static string Directive(ImportChunk chunk)
        => $"Extract only chunk '{chunk.Label}', covering block '{chunk.Block}', phase '{chunk.Phase}', absolute weeks {chunk.WeekFrom}-{chunk.WeekTo}, pages {chunk.PageFrom}-{chunk.PageTo}. " +
           $"The outline estimated about {chunk.DayCount} days; return every day these pages actually document, and no days from other chunks.";

    private async Task<bool> PersistProgressStage(Guid id, string leaseId, SemaphoreSlim persistGate,
        Func<string> resolveStage, IReadOnlyDictionary<int, string> sectionStages, CancellationToken ct)
    {
        await persistGate.WaitAsync(ct);
        try
        {
            await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
            var import = await db.Imports.SingleOrDefaultAsync(row => row.Id == id, ct);
            if (import is null || import.Status != ImportStatus.Pending || !OwnsLease(import, leaseId))
            {
                await gate.Commit(ct);
                return false;
            }

            var stage = resolveStage();
            if (stage is not ("extract" or "verify" or "recover")) stage = "extract";
            var state = ImportWorkState.Read(import.WorkStateJson);
            var persistedStages = sectionStages.ToDictionary(item => item.Key, item => item.Value);
            var now = DateTime.UtcNow;
            var changed = !string.Equals(import.Stage, stage, StringComparison.Ordinal)
                || !SameStages(state.SectionStages, persistedStages);
            if (changed)
            {
                import.Stage = stage;
                import.WorkStateJson = Json.Write(state with
                {
                    StartedAtUtc = state.StartedAtUtc ?? now,
                    LastProgressAtUtc = now,
                    SectionStages = persistedStages
                });
                import.Revision++;
                await db.SaveChangesAsync(ct);
            }
            RenewLease(import);
            if (!changed) await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            return true;
        }
        finally { persistGate.Release(); }
    }

    private static bool SameStages(IReadOnlyDictionary<int, string>? existing, IReadOnlyDictionary<int, string> next)
        => existing is not null && existing.Count == next.Count
            && existing.All(item => next.TryGetValue(item.Key, out var stage) && stage == item.Value);

    private async Task MeterInitialChunk(Guid id, string leaseId, CancellationToken ct)
    {
        var timer = Stopwatch.StartNew();
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(row => row.Id == id, ct);
        Validation.Require(import is not null && import.Status == ImportStatus.Pending && OwnsLease(import, leaseId),
            "This PDF import is no longer waiting for a read.", 409);
        await Meter(import!, ct);
        RenewLease(import!);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        logger?.LogInformation("Import AI-read reservation took {ElapsedMilliseconds} ms.", timer.ElapsedMilliseconds);
    }

    private async Task<int?> TryReserveRecoveryRead(Guid id, int chunkIndex, string leaseId,
        SemaphoreSlim persistGate, CancellationToken ct)
    {
        await persistGate.WaitAsync(ct);
        try
        {
            await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
            var import = await db.Imports.SingleOrDefaultAsync(row => row.Id == id, ct);
            if (import is null || import.Status != ImportStatus.Pending || !OwnsLease(import, leaseId))
            {
                await gate.Commit(ct);
                return null;
            }
            var state = ImportWorkState.Read(import.WorkStateJson);
            var reads = state.RecoveryReads ?? [];
            var count = reads.GetValueOrDefault(chunkIndex);
            if (count >= 2)
            {
                await gate.Commit(ct);
                return null;
            }
            try { await Meter(import, ct); }
            catch (DomainException)
            {
                await gate.Commit(ct);
                return null;
            }
            count++;
            reads[chunkIndex] = count;
            import.WorkStateJson = Json.Write(state with
            {
                LastProgressAtUtc = DateTime.UtcNow,
                RecoveryReads = reads
            });
            RenewLease(import);
            import.Revision++;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            return count;
        }
        finally { persistGate.Release(); }
    }

    /// Saves a completed provider response before its verification work. If the worker exits here,
    /// the response and its attempt reservation are enough to resume the comparison without
    /// repeating the paid read.
    private async Task<bool> PersistRecoveryCandidate(Guid id, int chunkIndex, string leaseId, int attempt,
        AiImportResult response, SemaphoreSlim persistGate, CancellationToken ct)
    {
        var timer = Stopwatch.StartNew();
        await persistGate.WaitAsync(ct);
        try
        {
            await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
            var import = await db.Imports.SingleOrDefaultAsync(row => row.Id == id, ct);
            if (import is null || import.Status != ImportStatus.Pending || !OwnsLease(import, leaseId))
            {
                await gate.Commit(ct);
                return false;
            }
            var state = ImportWorkState.Read(import.WorkStateJson);
            var candidates = state.RecoveryCandidates ?? [];
            if (!candidates.TryGetValue(chunkIndex, out var saved)) candidates[chunkIndex] = saved = [];
            var candidate = new ImportRecoveryCandidate(attempt, response, DateTime.UtcNow);
            var existing = saved.FindIndex(item => item.Attempt == attempt);
            if (existing >= 0) saved[existing] = candidate;
            else saved.Add(candidate);
            candidates[chunkIndex] = saved.OrderBy(item => item.Attempt).ToList();
            import.WorkStateJson = Json.Write(state with
            {
                LastProgressAtUtc = DateTime.UtcNow,
                RecoveryCandidates = candidates
            });
            RenewLease(import);
            import.Revision++;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            logger?.LogInformation("Import recovery candidate persistence took {ElapsedMilliseconds} ms for section {SectionIndex}, attempt {Attempt}.",
                timer.ElapsedMilliseconds, chunkIndex + 1, attempt);
            return true;
        }
        finally { persistGate.Release(); }
    }

    private async Task<bool> PersistRecoveryReasons(Guid id, int chunkIndex, string leaseId, int attempt,
        IReadOnlyList<string> reasons, SemaphoreSlim persistGate, CancellationToken ct)
    {
        await persistGate.WaitAsync(ct);
        try
        {
            await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
            var import = await db.Imports.SingleOrDefaultAsync(row => row.Id == id, ct);
            if (import is null || import.Status != ImportStatus.Pending || !OwnsLease(import, leaseId))
            {
                await gate.Commit(ct);
                return false;
            }
            var state = ImportWorkState.Read(import.WorkStateJson);
            var candidates = state.RecoveryCandidates ?? [];
            if (candidates.TryGetValue(chunkIndex, out var saved))
            {
                var index = saved.FindIndex(item => item.Attempt == attempt);
                if (index >= 0) saved[index] = saved[index] with { RepairReasons = [.. reasons] };
                candidates[chunkIndex] = saved;
            }
            import.WorkStateJson = Json.Write(state with
            {
                LastProgressAtUtc = DateTime.UtcNow,
                RecoveryCandidates = candidates
            });
            RenewLease(import);
            import.Revision++;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            return true;
        }
        finally { persistGate.Release(); }
    }

    private async Task<bool> PersistFinalChunkResult(Guid id, int chunkIndex, string leaseId, AiImportResult result,
        SemaphoreSlim persistGate, CancellationToken ct)
    {
        var timer = Stopwatch.StartNew();
        await persistGate.WaitAsync(ct);
        try
        {
            await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
            var import = await db.Imports.SingleOrDefaultAsync(row => row.Id == id, ct);
            if (import is not null && import.Status == ImportStatus.Pending && OwnsLease(import, leaseId))
            {
                var stored = ReadChunkResults(import.ChunkResultsJson);
                if (!stored.ContainsKey(chunkIndex))
                {
                    stored[chunkIndex] = result;
                    import.ChunkResultsJson = Json.Write(stored);
                    import.Model = result.Model;
                    import.InputTokens += result.InputTokens;
                    import.CachedInputTokens += result.CachedInputTokens;
                    import.OutputTokens += result.OutputTokens;
                    var state = ImportWorkState.Read(import.WorkStateJson);
                    var candidates = state.RecoveryCandidates ?? [];
                    candidates.Remove(chunkIndex);
                    import.WorkStateJson = Json.Write(state with
                    {
                        LastProgressAtUtc = DateTime.UtcNow,
                        RecoveryCandidates = candidates
                    });
                    import.Revision++;
                    await db.SaveChangesAsync(ct);
                }
                await gate.Commit(ct);
                logger?.LogInformation("Import section response persistence took {ElapsedMilliseconds} ms for section {SectionIndex}.",
                    timer.ElapsedMilliseconds, chunkIndex + 1);
                return true;
            }
            await gate.Commit(ct);
            return false;
        }
        finally { persistGate.Release(); }
    }

    /// Scores only evidence the current page text can check. Two additional reads are permitted
    /// per section; the lowest-scoring valid response is persisted, then final verification either
    /// confirms it or returns a specific failure instead of readying an incomplete draft.
    private async Task<ImportVerificationFinding> RecoveryScore(AiImportResult result, IReadOnlyList<ImportPageText> pages,
        int printedDays, ImportSourceAnalysis source, CancellationToken ct)
    {
        var enriched = ImportTableEvidence.Enrich(result.Program, source.Tables);
        var converted = await ToDraft(enriched, ct);
        var labeled = ImportDayLabels.Apply(converted, pages);
        var draft = labeled.Draft;
        var trainingDays = draft.Workouts.Count(day => !day.IsRestDay);
        var dayMismatch = printedDays > 0 ? Math.Abs(printedDays - trainingDays) : 0;
        var unsupportedIssues = ImportNameEvidence.Unsupported(draft, pages);
        var repeatedIssues = ImportNameEvidence.OverCounted(draft, pages);
        var prescriptionIssues = ReviewIssues(draft).Where(issue => issue.Code is "rpe_unread" or "rest_unread").ToList();
        var unsupported = unsupportedIssues.Count;
        var repeated = repeatedIssues.Count;
        var unread = prescriptionIssues.Count;
        var sourceLabels = ImportDayLabels.Read(pages);
        var repairPages = new HashSet<int>();
        if (dayMismatch > 0)
        {
            foreach (var (page, labels) in sourceLabels)
            {
                var actual = draft.Workouts.Count(workout => !workout.IsRestDay && SourcePage(workout) == page);
                if (actual != labels.Count) repairPages.Add(page);
            }
        }
        foreach (var issue in unsupportedIssues.Concat(repeatedIssues).Concat(prescriptionIssues))
            if (issue.SourcePage is { } page) repairPages.Add(page);
        var orderedPages = repairPages.Order().ToList();
        var targeted = orderedPages.Count is > 0 and <= 2 && source.Schedule is not null
            && orderedPages.All(page => source.Tables.Pages.ContainsKey(page)
                && source.DayLabels.TryGetValue(page, out var labels) && labels.Count > 0
                && ImportTableEvidence.HasCompleteDayGroup(source.Schedule.Days, source.Tables, page)
                && pages.FirstOrDefault(sourcePage => sourcePage.Page == page) is { } sourcePage
                && sourcePage.Text.Split('\n').Any(line => ImportStructureHeadings.TryWeek(line, out _)));
        return new ImportVerificationFinding(
            dayMismatch * 100 + unsupported * 20 + repeated * 20 + unread * 10,
            dayMismatch, unsupported, repeated, unread, orderedPages, targeted);
    }

    private static int? SourcePage(DraftWorkout workout)
    {
        if (workout.SourcePage is { } page) return page;
        var pages = workout.Exercises.SelectMany(exercise => new int?[] { exercise.SourcePage }
                .Concat(exercise.Sets.Select(set => set.SourcePage)))
            .Where(page => page.HasValue).Select(page => page!.Value).Distinct().Take(2).ToList();
        return pages.Count == 1 ? pages[0] : null;
    }
}
