using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Techniques holds each set position's intensity technique (SetTechniques keys, null for a straight
/// set or warm-up), so a client compares a myo-rep set with last time's myo-reps, not a straight set.
public sealed record RecentExerciseSets(Guid Id, Guid? ExerciseId, List<SetView> Sets, IReadOnlyList<string?> Techniques);
public sealed record RecentExerciseSession(Guid Id, string Name, DateTime StartedAt, DateTime? FinishedAt,
    List<RecentExerciseSets> Exercises);

public sealed partial class ExerciseService
{
    public async Task<List<RecentExerciseSession>> RecentSets(Guid id, int limit, CancellationToken ct)
    {
        Validation.Require(limit is >= 1 and <= 3, "Choose one to three recent sessions.");
        await Metadata(id, ct);
        var sessions = await db.Workouts.AsNoTracking()
            .Where(session => !session.Active && session.FinishedAt != null && db.SessionExercises.Any(exercise =>
                exercise.SessionId == session.Id && exercise.ExerciseId == id && db.Sets.Any(set =>
                    set.SessionExerciseId == exercise.Id && set.Done && !set.Warmup)))
            .OrderByDescending(session => session.FinishedAt)
            .ThenByDescending(session => session.Id).Take(limit)
            .Select(session => new { session.Id, session.Name, session.StartedAt, session.FinishedAt }).ToListAsync(ct);
        var sessionIds = sessions.Select(session => session.Id).ToList();
        var exercises = await db.SessionExercises.AsNoTracking()
            .Where(exercise => sessionIds.Contains(exercise.SessionId) && exercise.ExerciseId == id)
            .OrderBy(exercise => exercise.Position).Select(exercise => new { exercise.Id, exercise.SessionId, exercise.ExerciseId, exercise.PrescriptionJson })
            .ToListAsync(ct);
        var exerciseIds = exercises.Select(exercise => exercise.Id).ToList();
        var sets = await db.Sets.AsNoTracking().Where(set => exerciseIds.Contains(set.SessionExerciseId) && set.Done)
            .OrderBy(set => set.Position).Select(set => new { set.SessionExerciseId, View = new SetView(set.Id,
                set.Position, set.WeightKg, set.Reps, set.Rpe, set.Done, set.Warmup, set.WorkingSetOrdinal,
                set.ResistanceMode, set.SystemLoadKg, null, false, null, set.Rir, null, null, set.DurationSeconds) }).ToListAsync(ct);
        var byExercise = sets.ToLookup(set => set.SessionExerciseId, set => set.View);
        var bySession = exercises.ToLookup(exercise => exercise.SessionId);
        return sessions.Select(session => new RecentExerciseSession(session.Id, session.Name, session.StartedAt,
            session.FinishedAt, bySession[session.Id].Select(exercise => new RecentExerciseSets(exercise.Id,
                exercise.ExerciseId, byExercise[exercise.Id].ToList(), SetTechniques.ByPosition(exercise.PrescriptionJson))).ToList())).ToList();
    }
}
