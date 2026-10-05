using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public static class WorkoutAccounting
{
    public static (double? External, double? System) Volume(IReadOnlyList<SessionExercise> exercises, IReadOnlyList<CompletedSet> sets)
    {
        var models = exercises.ToDictionary(exercise => exercise.Id, exercise => exercise.LoadModel);
        var working = sets.Where(set => set.Done && !set.Warmup && set.DurationSeconds is null && set.Reps is not null).ToList();
        var external = working.Where(set => set.WeightKg is not null && set.SystemLoadKg is null &&
            models.GetValueOrDefault(set.SessionExerciseId, LoadModels.External) == LoadModels.External).ToList();
        var system = working.Where(set => set.SystemLoadKg is not null &&
            models.GetValueOrDefault(set.SessionExerciseId) == LoadModels.FullBodyweight).ToList();
        return (external.Count == 0 ? null : external.Sum(set => set.WeightKg!.Value * set.Reps!.Value),
            system.Count == 0 ? null : system.Sum(set => set.SystemLoadKg!.Value * set.Reps!.Value));
    }
}
