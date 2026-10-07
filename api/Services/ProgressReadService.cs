using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;

namespace Workout.Api.Services;

public static class ProgressReadService
{
    private static readonly string[] RecentFields = ["weekSessions", "weekVolumeKg", "weekWorkingSets"];

    public static async Task<object> Get(AppDb db, IMemoryCache cache, CancellationToken ct)
        => await RebuildableReadCache.Progress(db, cache, () => Build(db, ct), previous => RefreshRecent(db, previous, ct), ct);

    private static async Task<object> Build(AppDb db, CancellationToken ct)
    {
        var states = await db.Progress.AsNoTracking().ToListAsync(ct);
        var accumulator = new ProgressAccumulator(states, RecentCutoff());
        await Replay(db, accumulator, since: null, ct);
        return accumulator.Result();
    }

    /// Only the seven-day figures depend on the date. When history is unchanged, a new day keeps
    /// the lifetime figures and recounts just the last week instead of replaying every workout.
    private static async Task<object> RefreshRecent(AppDb db, JsonElement previous, CancellationToken ct)
    {
        var cutoff = RecentCutoff();
        var accumulator = new ProgressAccumulator([], cutoff);
        await Replay(db, accumulator, since: cutoff, ct);
        var recent = JsonSerializer.SerializeToNode(accumulator.Result(), Json.Options)!.AsObject();
        var refreshed = JsonNode.Parse(previous.GetRawText())!.AsObject();
        foreach (var field in RecentFields) refreshed[field] = recent[field]?.DeepClone();
        return refreshed;
    }

    private static DateTime RecentCutoff() => DateTime.UtcNow.Date.AddDays(-6);

    private static async Task Replay(AppDb db, ProgressAccumulator accumulator, DateTime? since, CancellationToken ct)
    {
        DateTime? beforeAt = null;
        Guid? beforeId = null;
        while (true)
        {
            var query = db.Workouts.AsNoTracking().Where(x => x.FinishedAt != null);
            if (since is { } from) query = query.Where(x => x.FinishedAt >= from);
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
    }
}
