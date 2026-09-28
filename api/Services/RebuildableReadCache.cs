using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System.Text.Json;
using Workout.Api.Data;

namespace Workout.Api.Services;

public static class RebuildableReadCache
{
    private static readonly SemaphoreSlim[] Gates = Enumerable.Range(0, 32).Select(_ => new SemaphoreSlim(1)).ToArray();
    private sealed record Snapshot(string Date, JsonElement Value);

    public static async Task<object> Progress(AppDb db, IMemoryCache cache, Func<Task<object>> build, CancellationToken ct)
    {
        var user = db.CurrentUser!.Value;
        var gate = Gates[(user.GetHashCode() & int.MaxValue) % Gates.Length];
        var coordinated = db.Database.CurrentTransaction == null;
        var useStripe = coordinated && !db.Database.IsSqlite();
        if (useStripe) await gate.WaitAsync(ct);
        try
        {
            var generation = await db.ResourceGenerations.AsNoTracking().Where(x => x.UserId == user).Select(x => (long?)x.Progress).SingleOrDefaultAsync(ct) ?? 0;
            var date = DateTime.UtcNow.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
            var key = $"progress:{user:N}:{generation}:{date}";
            if (coordinated && cache.TryGetValue(key, out object? value) && value != null) return value;
            var row = await db.TrainingReadModels.AsNoTracking().SingleOrDefaultAsync(x => x.Kind == "progress" && x.SourceId == Guid.Empty, ct);
            if (row?.Generation == generation && row.Version == 1)
            {
                var snapshot = Json.Read<Snapshot>(row.Json);
                if (snapshot.Date == date)
                {
                    if (coordinated) cache.Set(key, (object)snapshot.Value, new MemoryCacheEntryOptions { Size = 1, AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30) });
                    return snapshot.Value;
                }
            }
            await using var mutation = coordinated ? await MutationLock.Acquire(db, user, ct) : null;
            generation = await db.ResourceGenerations.AsNoTracking().Select(x => (long?)x.Progress).SingleOrDefaultAsync(ct) ?? 0;
            // Another instance may have published while this request waited for the account lock.
            row = await db.TrainingReadModels.AsNoTracking().SingleOrDefaultAsync(x => x.Kind == "progress" && x.SourceId == Guid.Empty, ct);
            if (row?.Generation == generation && row.Version == 1)
            {
                var snapshot = Json.Read<Snapshot>(row.Json);
                if (snapshot.Date == date)
                {
                    if (mutation != null) await mutation.Commit(ct);
                    return snapshot.Value;
                }
            }
            var result = await build();
            var json = Json.Write(new Snapshot(date, JsonSerializer.SerializeToElement(result, Json.Options)));
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "TrainingReadModels" ("UserId", "Kind", "SourceId", "Generation", "Version", "Json")
                VALUES ({user}, {"progress"}, {Guid.Empty}, {generation}, {1}, {json})
                ON CONFLICT ("UserId", "Kind", "SourceId") DO UPDATE SET
                "Generation" = {generation}, "Version" = {1}, "Json" = {json}
                """, ct);
            if (mutation != null) await mutation.Commit(ct);
            // Never publish data from somebody else's still-open transaction into process memory.
            if (coordinated) cache.Set($"progress:{user:N}:{generation}:{date}", result,
                new MemoryCacheEntryOptions { Size = 1, AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30) });
            return result;
        }
        finally { if (useStripe) gate.Release(); }
    }
}
