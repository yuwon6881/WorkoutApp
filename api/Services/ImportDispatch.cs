using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Durable delivery of the next extraction pass and the daily AI read budget.
public sealed partial class ImportService
{
    /// A chunk is only worth delivering when a worker can actually read its source; arming a
    /// key-less import would enqueue a task that can do nothing but fail.
    private static void MarkDispatch(AiImport import)
    {
        if (import.Status == ImportStatus.Pending && import.Stage == "extract" && import.ChunksDone < import.ChunksTotal
            && !string.IsNullOrEmpty(import.SourceFileKey))
        {
            import.PendingDispatchChunk = import.ChunksDone;
            import.PendingDispatchAt = DateTime.UtcNow;
        }
        else
        {
            import.PendingDispatchChunk = null;
            import.PendingDispatchAt = null;
        }
    }

    private async Task<bool> TryDispatch(Guid userId, Guid importId, int? expectedChunk, CancellationToken ct)
    {
        if (jobs is null || expectedChunk is not { } chunk) return false;
        if (!await jobs.Enqueue(userId, importId, chunk, ct)) return false;

        var previousUser = db.CurrentUser;
        db.CurrentUser = userId;
        try
        {
            await using var gate = await MutationLock.Acquire(db, userId, ct);
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, ct);
            // A row written before dispatch markers existed has no marker to match; its next
            // chunk is still the one being delivered.
            if (import is not null && import.Status == ImportStatus.Pending &&
                (import.PendingDispatchChunk == chunk ||
                 (import.PendingDispatchChunk is null && import.Stage == "extract" && import.ChunksDone == chunk)))
            {
                import.PendingDispatchChunk = chunk;
                // Keep the marker until the task commits. The lease lets hourly maintenance
                // recover a task lost during worker startup without creating an unbounded queue.
                import.PendingDispatchAt = DateTime.UtcNow.AddMinutes(30);
                import.Revision++;
                await db.SaveChangesAsync(ct);
            }
            await gate.Commit(ct);
            return true;
        }
        finally { db.CurrentUser = previousUser; }
    }

    /// Re-enqueues extraction chunks whose delivery was never accepted or whose delivery lease
    /// expired while a worker was restarting. This is intentionally bounded so the maintenance
    /// endpoint remains cheap even if a user has accumulated stale imports. An import with no
    /// stored source is skipped: no worker can read it, so enqueuing it would only loop.
    public async Task<int> RecoverUndispatched(CancellationToken ct)
    {
        if (jobs is null) return 0;
        var previousUser = db.CurrentUser;
        var previousMaintenance = db.MaintenanceAccess;
        db.MaintenanceAccess = true;
        try
        {
            var now = DateTime.UtcNow;
            var candidates = await db.Imports.IgnoreQueryFilters().AsNoTracking()
                .Where(i => i.Status == ImportStatus.Pending && i.SourceFileKey != "" &&
                    ((i.Stage == "extract" && i.ChunksDone < i.ChunksTotal) ||
                     (i.Stage == "outline" && i.PendingDispatchChunk != null)) &&
                    (i.PendingDispatchChunk == null || i.PendingDispatchAt == null || i.PendingDispatchAt <= now))
                .OrderBy(i => i.Created).Take(32)
                .Select(i => new { i.UserId, i.Id, Chunk = i.PendingDispatchChunk ?? i.ChunksDone }).ToListAsync(ct);
            var recovered = 0;
            foreach (var candidate in candidates)
            {
                if (await TryDispatch(candidate.UserId, candidate.Id, candidate.Chunk, ct)) recovered++;
                db.ChangeTracker.Clear();
            }
            return recovered;
        }
        finally
        {
            db.CurrentUser = previousUser;
            db.MaintenanceAccess = previousMaintenance;
        }
    }

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
