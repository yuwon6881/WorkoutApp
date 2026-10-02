using Workout.Api.Data;

namespace Workout.Api.Services;

/// The versions a client compares before reusing an account resource it already holds.
/// Catalog and template payloads carry load steps resolved in the account unit, so a unit
/// switch alone must make the client fetch them again.
public sealed record ResourceVersions(string Catalog, string Programs, string Templates, string History = "")
{
    public static ResourceVersions For(ResourceGeneration generation, string unit) => new(
        $"{generation.CustomExercises}:{generation.ExerciseLoads}:{unit}",
        $"{generation.Programs}:{generation.Templates}",
        $"{generation.Templates}:{generation.ExerciseLoads}:{unit}",
        $"{generation.History}:{generation.Progress}");
}
