using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// <summary>
/// Computes a lightweight entity tag (ETag) for the active workout watch polling endpoint.
/// Each segment of the tag is included for specific cache invalidation:
/// - userId: scopes the tag to the authenticated account.
/// - user preferences (unit, restSeconds, trackRir): invalidate when display units, rest timer, or RIR preference change.
/// - counters (programs, templates, sessions, imports, progress, customExercises, exerciseLoads, preferences, history): cover every other user-owned input transactionally bumped in ResourceGenerations.
/// - activeId or none: distinguishes whether an active workout exists ("none" vs session GUID).
/// - activeRevision: revision covers every session edit made during the live workout.
/// - restElapsed (0 or 1): rest elapsed covers the time-dependent field when a running rest passes its deadline (RestDeadlineUtc &lt;= DateTime.UtcNow).
/// - catalogVersion (ModuleVersionId): assembly id covers the seed catalog so any new deployment invalidates every tag.
/// </summary>
public static class WatchActiveTag
{
    private static readonly Guid CatalogVersion = typeof(WatchActiveTag).Assembly.ManifestModule.ModuleVersionId;

    public static async Task<string> Compute(AppDb db, AppUser user, CancellationToken ct = default)
    {
        var generation = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
        var active = await db.Workouts.AsNoTracking()
            .Where(w => w.Active)
            .Select(w => new { w.Id, w.Revision, w.RestStatus, w.RestDeadlineUtc })
            .SingleOrDefaultAsync(ct);

        var activeId = active is not null ? active.Id.ToString("N") : "none";
        var activeRevision = active?.Revision ?? 0;
        var restElapsed = active is not null &&
            active.RestStatus == WorkoutRestStatus.Running &&
            active.RestDeadlineUtc is { } deadline &&
            deadline <= DateTime.UtcNow ? 1 : 0;

        return $"\"watch-active:{user.Id:N}:{user.Unit}:{user.RestSeconds}:{user.TrackRir}:{generation.Programs}:{generation.Templates}:{generation.Sessions}:{generation.Imports}:{generation.Progress}:{generation.CustomExercises}:{generation.ExerciseLoads}:{generation.Preferences}:{generation.History}:{activeId}:{activeRevision}:{restElapsed}:{CatalogVersion:N}\"";
    }
}
