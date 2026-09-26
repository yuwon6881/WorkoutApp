using System.Globalization;

namespace Workout.Api.Domain;

internal static class ProgressionEvidence
{
    // 5+ is a lower bound, never an assertion that exactly five reps remained.
    public static double? Reserve(string? rir, double? rpe)
    {
        if (rir?.Trim() == "5+") return 5;
        if (double.TryParse(rir, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && value is >= 0 and <= 10)
            return value;
        return rpe is { } effort ? Math.Max(0, 10 - effort) : null;
    }

    public static double? Reserve(SetExposure exposure) => Reserve(exposure.Rir, exposure.Rpe);

    public static bool MeetsEffort(SetExposure exposure, double? goal)
        => goal is null || Reserve(exposure) is { } reserve && reserve >= goal;

    public static bool Hard(SetExposure exposure, int minimum, double? goal)
        => goal is { } target && Reserve(exposure) is { } reserve
            ? reserve <= target - 1
            : goal is null && exposure.Reps < minimum && !exposure.IsRepRangeTransition;

    public static bool SameLoad(double? left, double? right)
        => left is null && right is null || left is { } l && right is { } r && Math.Abs(l - r) < .0001;

    public static bool Changed(SetExposure source, int? min, int? max, double? goal)
        => source.HasPrescription && (source.RepMin != min || source.RepMax != max ||
            Reserve(source.TargetRir, source.TargetRpe) != goal);

    // A local load/reps heuristic, deliberately separate from PR/e1RM reporting. It is used
    // only up to 30 effective reps, and never claimed to guarantee the prescribed effort.
    public static double? Capacity(SetExposure source, double? load)
        => load is > 0 && source.Reps is > 0 && source.Reps + (Reserve(source) ?? 0) <= 30
            ? load * (30 + source.Reps + (Reserve(source) ?? 0)) : null;

    public static int? RepsAt(SetExposure source, double? oldLoad, double newLoad, double? goal)
    {
        if (newLoad <= 0 || Capacity(source, oldLoad) is not { } capacity) return null;
        return (int)Math.Floor(capacity / newLoad - 30 - (goal ?? Reserve(source) ?? 0) + 1e-9);
    }

    public static int Streak(IEnumerable<SetExposure> history, Func<SetExposure, bool> predicate)
        => history.TakeWhile(predicate).Count();
}
