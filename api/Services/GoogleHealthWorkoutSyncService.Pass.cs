using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

/// One processing pass over due uploads. A pass may cover several owners on one context, so each
/// item runs as its owner and a failed item is contained to itself.
public sealed partial class GoogleHealthWorkoutSyncService
{
    /// Processes due uploads for every account (the daily sweep), or for one account while its user
    /// is active. A budget cancels in-progress work; an unfinished record retains its lease.
    public async Task<GoogleHealthWorkoutSyncProcessResult> ProcessDueAsync(CancellationToken ct, Guid? userId = null, TimeSpan? budget = null)
    {
        ct.ThrowIfCancellationRequested();
        if (budget <= TimeSpan.Zero) return new(0, 0, 0, 0, 0);
        using var passDeadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        if (budget is { } passBudget) passDeadline.CancelAfter(passBudget);
        ct = passDeadline.Token;
        var started = DateTime.UtcNow;
        var deadline = budget is { } limit ? started.Add(limit) : DateTime.MaxValue;
        var candidates = await db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters()
            .Where(x => (userId == null || x.UserId == userId)
                && new[] { "pending", "processing", "awaiting_operation" }.Contains(x.ProcessingState)
                && x.NextAttemptAt <= started
                && (x.LeaseUntil == null || x.LeaseUntil < started))
            .OrderBy(x => x.NextAttemptAt)
            .ThenBy(x => x.CreatedAt)
            .Take(25)
            .Select(x => new { x.UserId, x.Id })
            .ToListAsync(ct);

        var processed = 0;
        var succeeded = 0;
        var retried = 0;
        var failed = 0;
        var unknown = 0;

        var originalCurrentUser = db.CurrentUser;
        foreach (var item in candidates)
        {
            if (ct.IsCancellationRequested || DateTime.UtcNow >= deadline) break;
            db.CurrentUser = item.UserId;
            try
            {
                var leaseId = Guid.NewGuid().ToString("N");
                var leased = await LeaseWorkAsync(item.UserId, item.Id, leaseId, started, ct);
                if (leased is null) continue;

                processed++;
                var result = await ProcessLeasedAsync(leased, ct);
                switch (result)
                {
                    case "succeeded": succeeded++; break;
                    case "retried": retried++; break;
                    case "failed": failed++; break;
                    case "unknown": unknown++; break;
                }
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                // One owner's failed write must not end the pass for the owners after it, nor leave
                // its unsaved edits tracked where the next owner's save would try to write them.
                // The item keeps its lease, so a later pass picks it up (or marks it uncertain).
                db.ChangeTracker.Clear();
                retried++;
            }
            finally
            {
                db.CurrentUser = originalCurrentUser;
            }
        }

        return new(processed, succeeded, retried, failed, unknown);
    }
}
