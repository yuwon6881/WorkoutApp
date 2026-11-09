using System.Collections.Frozen;
using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;

namespace Workout.Api.Services;

internal sealed record SeedMetadata(Guid Id, string Name, bool Active, string LoadModel, double LoadStepKg,
    string Equipment, string TrackingMode, string WeightBasis, string Muscle, string SecondaryMusclesJson);

/// Identity lookups include inactive and synonym identities: the picker cache deliberately omits
/// them, but saved workouts must continue to read their original metadata.
internal static class CatalogMetadata
{
    private static readonly MemoryCache Cache = new(new MemoryCacheOptions { SizeLimit = 4 });
    private static readonly ConditionalWeakTable<AppDb, RequestMetadata> Requests = new();
    private sealed record RequestMetadata(IReadOnlyDictionary<Guid, SeedMetadata> Value);

    public static async Task<IReadOnlyDictionary<Guid, SeedMetadata>> Read(AppDb db, CancellationToken ct)
    {
        var sqlite = db.Database.IsSqlite();
        if (!sqlite && Requests.TryGetValue(db, out var local)) return local.Value;
        var connection = db.Database.GetDbConnection();
        var key = $"{connection.DataSource}:{connection.Database}";
        if (!sqlite && Cache.TryGetValue<IReadOnlyDictionary<Guid, SeedMetadata>>(key, out var cached)
            && cached is not null) return cached;

        var rows = await db.Exercises.AsNoTracking().Select(x => new SeedMetadata(x.Id, x.Name, x.Active,
            x.LoadModel, x.LoadStepKg, x.Equipment, x.TrackingMode, x.WeightBasis, x.Muscle, x.SecondaryMusclesJson)).ToListAsync(ct);
        var result = rows.ToFrozenDictionary(x => x.Id);
        if (!sqlite) Requests.Add(db, new RequestMetadata(result));
        // An isolated SQLite harness and an uncommitted seed must never publish process-wide data.
        if (!sqlite && db.Database.CurrentTransaction is null)
            Cache.Set(key, (IReadOnlyDictionary<Guid, SeedMetadata>)result,
                new MemoryCacheEntryOptions { Size = 1, AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10) });
        return result;
    }
}
