namespace Workout.Api.Domain;

/// Two evidence rules that sit on top of double progression: a set far easier than its target
/// calibrates faster (capped), and a stall at the target effort is not left to repeat forever.
internal static class ProgressionCalibration
{
    private const double ExtraReserve = 2;
    private const int MaxExtraReps = 3;
    private const double MaxJump = 1.1;
    public const int PlateauSessions = 4;
    private const double PlateauReset = .95;

    /// Only in normal mode, only with a known target, and only when the set was easier than both the
    /// new target and the target it was performed against. A "5+" reserve is a lower bound, so the
    /// caps below matter more than the estimate. Reps done past the top of the range are reserve the
    /// set never needed, so twenty reps at the target effort on an 8-10 set count as far easier too.
    public static bool Applies(string mode, SetExposure source, double? goal, bool repsOnly, int? upper = null)
    {
        if (mode != ProgressionModes.Normal || repsOnly || goal is not { } target || source.IsRepRangeTransition) return false;
        if (ProgressionEvidence.Reserve(source) is not { } logged) return false;
        var surplus = upper is { } top && source.Reps is { } reps && reps > top ? reps - top : 0;
        var reserve = logged + surplus;
        var own = ProgressionEvidence.Reserve(source.TargetRir, source.TargetRpe) ?? target;
        return reserve >= target + ExtraReserve && reserve >= own + ExtraReserve;
    }

    public static int RepGain(double reserve, double goal)
        => (int)Math.Clamp(Math.Floor(reserve - goal), 1, MaxExtraReps);

    /// The load the logged reps and reserve predict for the bottom of the range at the target effort,
    /// never more than ten percent or two equipment steps above the current load.
    public static double? Load(SetExposure source, double load, double goal, int lower, LoadOptions loads)
    {
        if (ProgressionEvidence.Capacity(source, load) is not { } capacity) return null;
        var cap = Math.Min(load * MaxJump, loads.Next(loads.Next(load)));
        return loads.AtMost(Math.Min(capacity / (30 + lower + goal), cap));
    }

    /// Four exposures at one load with no rep gain, all worked at or beyond the target effort.
    public static bool Plateaued(IReadOnlyList<SetExposure> history, double? load, double? goal, Func<SetExposure, double?> selector)
    {
        if (goal is not { } target || history.Count < PlateauSessions) return false;
        var recent = history.Take(PlateauSessions).ToList();
        if (recent.Any(exposure => exposure.Reps is null || exposure.IsRepRangeTransition ||
                !ProgressionEvidence.SameLoad(load, selector(exposure)) ||
                ProgressionEvidence.Reserve(exposure) is not { } reserve || reserve > target)) return false;
        return recent.Take(PlateauSessions - 1).Max(exposure => exposure.Reps!.Value) <= recent[^1].Reps!.Value;
    }

    public static double ResetLoad(double load, LoadOptions loads)
    {
        var reduced = loads.AtMost(load * PlateauReset);
        return reduced < load ? reduced : loads.Previous(load);
    }
}
