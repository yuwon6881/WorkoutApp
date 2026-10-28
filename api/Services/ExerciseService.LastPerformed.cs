using Microsoft.EntityFrameworkCore;

namespace Workout.Api.Services;

/// The top working set of the most recent finished workout that logged the exercise: the heaviest
/// load, then the most reps (or the longest hold for timed sets). Null fields stay unknown.
public sealed record ExerciseLastPerformed(Guid ExerciseId, DateTime FinishedAt, double? WeightKg, int? Reps, int? DurationSeconds);

public sealed partial class ExerciseService
{
    /// One row per exercise the account has finished a working set of, for the library's cards.
    /// Two bounded reads: the latest session exercise per movement, then only those rows' sets.
    public async Task<List<ExerciseLastPerformed>> LastPerformed(CancellationToken ct)
    {
        var logged = await (
            from exercise in db.SessionExercises.AsNoTracking()
            join session in db.Workouts.AsNoTracking() on exercise.SessionId equals session.Id
            where exercise.ExerciseId != null && !session.Active && session.FinishedAt != null
                && db.Sets.Any(set => set.SessionExerciseId == exercise.Id && set.Done && !set.Warmup)
            select new { exercise.Id, ExerciseId = exercise.ExerciseId!.Value, FinishedAt = session.FinishedAt!.Value }
        ).ToListAsync(ct);
        var latest = logged.GroupBy(row => row.ExerciseId)
            .Select(group => group.OrderByDescending(row => row.FinishedAt).ThenByDescending(row => row.Id).First())
            .ToList();
        if (latest.Count == 0) return [];

        var rowIds = latest.Select(row => row.Id).ToList();
        var sets = await db.Sets.AsNoTracking()
            .Where(set => rowIds.Contains(set.SessionExerciseId) && set.Done && !set.Warmup)
            .Select(set => new { set.SessionExerciseId, set.WeightKg, set.Reps, set.DurationSeconds })
            .ToListAsync(ct);
        var setsByRow = sets.ToLookup(set => set.SessionExerciseId);
        return latest.Select(row =>
        {
            var top = setsByRow[row.Id]
                .OrderByDescending(set => set.WeightKg ?? double.MinValue)
                .ThenByDescending(set => set.Reps ?? 0)
                .ThenByDescending(set => set.DurationSeconds ?? 0)
                .First();
            return new ExerciseLastPerformed(row.ExerciseId, row.FinishedAt, top.WeightKg, top.Reps, top.DurationSeconds);
        }).ToList();
    }
}
