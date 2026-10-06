using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;

namespace Workout.Api.Services;

public sealed partial class ExerciseService
{
    private static readonly object InsightCacheGate = new();
    private sealed class CachedInsight
    {
        public SemaphoreSlim Gate { get; } = new(1, 1);
        public ExerciseInsight? Value { get; set; }
    }

    public async Task<ExerciseInsight> Insight(Guid id, string? range, int page, int size, CancellationToken ct)
    {
        if (cache is null) return await BuildInsight(id, range, page, size, ct);
        // Metadata authorization is current even when the numerical result can be reused.
        await Metadata(id, ct);
        var revision = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
        var key = $"exercise-insight:v3:{db.CurrentUser}:{id}:{revision.History}:{revision.Progress}:{revision.CustomExercises}:{revision.ExerciseLoads}:{revision.Programs}:{DateTime.UtcNow:yyyyMMdd}:{range}:{page}:{size}";
        CachedInsight stored;
        lock (InsightCacheGate)
            stored = cache.GetOrCreate(key, entry => {
                entry.Size = 1;
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
                return new CachedInsight();
            })!;
        await stored.Gate.WaitAsync(ct);
        try { return stored.Value ??= await BuildInsight(id, range, page, size, ct); }
        finally { stored.Gate.Release(); }
    }
}
