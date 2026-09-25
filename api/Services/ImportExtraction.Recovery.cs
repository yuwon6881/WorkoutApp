using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    /// What one section asks the model for. The outline's day count travels with it as an estimate
    /// rather than an instruction, because the pages themselves are the authority on how many days
    /// they document.
    private static string Directive(ImportChunk chunk)
        => $"Extract only chunk '{chunk.Label}', covering block '{chunk.Block}', phase '{chunk.Phase}', absolute weeks {chunk.WeekFrom}-{chunk.WeekTo}, pages {chunk.PageFrom}-{chunk.PageTo}. " +
           $"The outline estimated about {chunk.DayCount} days; return every day these pages actually document, and no days from other chunks.";

    private async Task<bool> PersistProgressStage(Guid id, string leaseId, SemaphoreSlim persistGate,
        Func<string> resolveStage, CancellationToken ct)
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
            if (!string.Equals(import.Stage, stage, StringComparison.Ordinal))
            {
                import.Stage = stage;
                import.Revision++;
            }
            RenewLease(import);
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            return true;
        }
        finally { persistGate.Release(); }
    }

    private async Task<bool> TryReserveRecoveryRead(Guid id, string leaseId, SemaphoreSlim persistGate, CancellationToken ct)
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
            try { await Meter(import, ct); }
            catch (DomainException)
            {
                await gate.Commit(ct);
                return false;
            }
            RenewLease(import);
            import.Revision++;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            return true;
        }
        finally { persistGate.Release(); }
    }

    /// Scores only evidence the current page text can check. Two additional reads are permitted
    /// per section; the lowest-scoring valid response is persisted, then final verification either
    /// confirms it or returns a specific failure instead of readying an incomplete draft.
    private async Task<int> RecoveryScore(AiImportResult result, IReadOnlyList<ImportPageText> pages,
        int printedDays, CancellationToken ct)
    {
        var enriched = ImportTableEvidence.Enrich(result.Program, ImportSourceText.Slice(pages,
            pages.Count == 0 ? 1 : pages.Min(page => page.Page), pages.Count == 0 ? 1 : pages.Max(page => page.Page)));
        var converted = await ToDraft(enriched, ct);
        var labeled = ImportDayLabels.Apply(converted, pages);
        var draft = labeled.Draft;
        var trainingDays = draft.Workouts.Count(day => !day.IsRestDay);
        var dayMismatch = printedDays > 0 ? Math.Abs(printedDays - trainingDays) * 100 : 0;
        var warningCount = labeled.Notices.Count(issue => issue.Severity != "info")
            + ReviewIssues(draft).Count(issue => issue.Severity != "info")
            + ImportNameEvidence.Unsupported(draft, pages).Count
            + ImportNameEvidence.OverCounted(draft, pages).Count;
        return dayMismatch + warningCount * 20;
    }
}
