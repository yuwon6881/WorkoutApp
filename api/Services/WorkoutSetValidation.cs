using Workout.Api.Domain;

namespace Workout.Api.Services;

internal static class WorkoutSetValidation
{
    public static void Tracking(bool timed, int? reps, int? seconds, double? rpe, string? rir, bool done)
    {
        if (timed)
        {
            Validation.Require(reps is null && rpe is null && rir is null,
                "Timed sets record seconds, without reps or effort.");
            Validation.Require(!done || seconds is not null, "A completed timed set needs its seconds.");
        }
        else
        {
            Validation.Require(seconds is null, "This exercise records reps, not seconds.");
            Validation.Require(!done || reps is not null, "A completed set needs its reps.");
        }
    }
}
