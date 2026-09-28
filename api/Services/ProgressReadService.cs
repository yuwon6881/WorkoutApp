using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;

namespace Workout.Api.Services;

public static class ProgressReadService
{
    public static async Task<object> Get(AppDb db, IMemoryCache cache, CancellationToken ct)
        => await RebuildableReadCache.Progress(db, cache, () => Build(db, ct), ct);

    private static async Task<object> Build(AppDb db, CancellationToken ct)
    {
        var states = await db.Progress.AsNoTracking().ToListAsync(ct);
        var accumulator = new ProgressAccumulator(states, DateTime.UtcNow.Date.AddDays(-6));
        DateTime? beforeAt = null;
        Guid? beforeId = null;
        while (true)
        {
            var query = db.Workouts.AsNoTracking().Where(x => x.FinishedAt != null);
            if (beforeAt is { } at && beforeId is { } id)
                query = query.Where(x => x.FinishedAt < at || x.FinishedAt == at && x.Id.CompareTo(id) < 0);
            var batch = await query.OrderByDescending(x => x.FinishedAt).ThenByDescending(x => x.Id).Take(64).ToListAsync(ct);
            if (batch.Count == 0) break;
            var ids = batch.Select(x => x.Id).ToList();
            var exercises = await db.SessionExercises.AsNoTracking().Where(x => ids.Contains(x.SessionId)).ToListAsync(ct);
            var exerciseIds = exercises.Select(x => x.Id).ToList();
            var sets = await db.Sets.AsNoTracking().Where(x => exerciseIds.Contains(x.SessionExerciseId) && x.Done && !x.Warmup).ToListAsync(ct);
            accumulator.Add(batch, exercises, sets);
            beforeAt = batch[^1].FinishedAt;
            beforeId = batch[^1].Id;
            if (batch.Count < 64) break;
        }
        return accumulator.Result();
    }
}
