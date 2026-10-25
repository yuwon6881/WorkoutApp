using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

/// Backs `GET /health?db=1`. The page sends it while its scripts download, so the Cloud Run cold
/// start and the serverless database wake-up overlap that download instead of following it.
/// The endpoint is public, so a probe that succeeded recently answers later calls without touching
/// the database again; a flood of calls cannot keep the database awake or load it.
public sealed class DatabaseWarmup(ILogger<DatabaseWarmup> logger, TimeProvider? time = null)
{
    private static readonly TimeSpan ReuseWindow = TimeSpan.FromSeconds(30);
    private readonly TimeProvider clock = time ?? TimeProvider.System;
    private long confirmedUntilTicks;

    public async Task<bool> EnsureAwakeAsync(AppDb db, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcTicks;
        if (now < Interlocked.Read(ref confirmedUntilTicks)) return true;
        try
        {
            await db.Database.ExecuteSqlRawAsync("SELECT 1", ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The caller reports the state; the page's own requests retry on their normal path.
            logger.LogWarning(ex, "Database warm-up probe failed.");
            return false;
        }
        Interlocked.Exchange(ref confirmedUntilTicks, now + ReuseWindow.Ticks);
        return true;
    }
}
