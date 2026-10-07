using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;
using Workout.Api.Domain;

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
        Validation.Require(page >= 0 && size is > 0 and <= 100, "Invalid exercise history page.");
        if (cache is null) return Slice(await BuildInsight(id, ct), range, page, size);
        // Metadata authorization is current even when the numerical result can be reused.
        await Metadata(id, ct);
        var revision = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
        // The whole-history figures are shared by every range and page, so switching either
        // reuses them instead of reading the exercise's history again.
        var source = $"exercise-insight:v4:{db.CurrentUser}:{id}:{revision.History}:{revision.Progress}:{revision.CustomExercises}:{revision.ExerciseLoads}:{revision.Programs}";
        var view = $"{source}:{DateTime.UtcNow:yyyyMMdd}:{range}:{page}:{size}";
        return await Cached(view, async () => Slice(await Cached(source, () => BuildInsight(id, ct), ct), range, page, size), ct);
    }

    private async Task<ExerciseInsight> Cached(string key, Func<Task<ExerciseInsight>> build, CancellationToken ct)
    {
        CachedInsight stored;
        lock (InsightCacheGate)
            stored = cache!.GetOrCreate(key, entry => {
                entry.Size = 1;
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
                return new CachedInsight();
            })!;
        await stored.Gate.WaitAsync(ct);
        try { return stored.Value ??= await build(); }
        finally { stored.Gate.Release(); }
    }
}
