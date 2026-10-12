namespace Workout.Api.Domain;

/// Where a set lands when it was logged harder than the effort now asked of it.
public sealed record RetargetedSet(double? LoadKg, int Reps, bool Lighter);

/// Re-aims a set that went closer to failure than its target. Its reps to failure (reps + reserve)
/// is what the load allows; minus the target reserve, that is the honest rep target at the same load
/// (Epley extended with reps in reserve, the estimate the rest of the policy uses). When that falls
/// below the prescription, the load the same estimate gives for the minimum at the target effort is
/// chosen instead, rounded down to a real weight.
internal static class ProgressionRetarget
{
    public static RetargetedSet? Aim(SetExposure source, double? load, int lower, int upper, double goal,
        LoadOptions loads, bool repsOnly)
    {
        if (source.Reps is not { } reps || ProgressionEvidence.Reserve(source) is not { } reserve) return null;
        var aim = (int)Math.Floor(reps + reserve - goal + 1e-9);
        if (aim >= lower) return new RetargetedSet(load, Math.Min(aim, upper), false);
        if (loads.Adjustable && !repsOnly && load is > 0 && ProgressionEvidence.Capacity(source, load) is { } capacity)
        {
            var selected = loads.AtMost(capacity / (30 + lower + goal));
            if (selected > 0 && selected < load) return new RetargetedSet(selected, lower, true);
        }
        // No lighter weight exists: the reps the load allows at the target effort are the target.
        return new RetargetedSet(load, Math.Max(1, aim), false);
    }

    public static string Reason(RetargetedSet aimed, double? before)
        => aimed.Lighter && aimed.LoadKg is { } lighter && before is > 0
            ? $"Last time fell short of the range at the target effort: about {(int)Math.Round((1 - lighter / before.Value) * 100)}% lighter for {aimed.Reps} reps."
            : $"Last time was harder than the target effort: aim for {aimed.Reps} reps at the same load to land on it.";
}
