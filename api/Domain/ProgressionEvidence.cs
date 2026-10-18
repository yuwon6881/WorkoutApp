using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Domain;

internal static class ProgressionEvidence
{
    // 5+ is a lower bound, never an assertion that exactly five reps remained. A printed target range
    // ("1-2") or floor ("1+") counts by its harder end: stopping at one in reserve is within it,
    // reaching failure is not.
    public static double? Reserve(string? rir, double? rpe)
    {
        var text = rir?.Trim();
        if (text == "5+") return 5;
        if (Number(text) is { } value) return value;
        if (text is { Length: > 0 } && RirRange.Match(text) is { Success: true } range &&
            Number(range.Groups["first"].Value) is { } first)
            return range.Groups["second"].Success && Number(range.Groups["second"].Value) is { } second
                ? Math.Min(first, second) : first;
        return rpe is { } effort ? Math.Max(0, 10 - effort) : null;
    }

    private static readonly Regex RirRange =
        new(@"^(?<first>\d+(?:\.\d+)?)\s*(?:(?:-|–|—|to)\s*(?<second>\d+(?:\.\d+)?)|\+)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static double? Number(string? text)
        => double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && value is >= 0 and <= 10 ? value : null;

    public static double? Reserve(SetExposure exposure) => Reserve(exposure.Rir, exposure.Rpe);

    public static bool MeetsEffort(SetExposure exposure, double? goal)
        => goal is null || Reserve(exposure) is { } reserve && reserve >= goal;

    // Without a recorded reserve, falling short of the minimum is the only sign the load was too
    // heavy, whether or not the program states a target effort.
    public static bool Hard(SetExposure exposure, int minimum, double? goal)
        => goal is { } target && Reserve(exposure) is { } reserve
            ? reserve <= target - 1
            : exposure.Reps < minimum && !exposure.IsRepRangeTransition;

    public static bool SameLoad(double? left, double? right)
        => left is null && right is null || left is { } l && right is { } r && Math.Abs(l - r) < .0001;

    public static bool Changed(SetExposure source, int? min, int? max, double? goal)
        => source.HasPrescription && (source.RepMin != min || source.RepMax != max || EffortTargetChanged(source, goal));

    /// The most a weekly RIR taper (for example 3 to 2 to 1) may move before the prescription counts as
    /// a different one whose history no longer applies.
    public const double TaperReserve = 2;

    // A routine taper is the same progression: the set already met the new, harder target, so its
    // reps and reserve remain valid evidence. Anything larger or unmet is a real change.
    private static bool EffortTargetChanged(SetExposure source, double? goal)
    {
        var own = Reserve(source.TargetRir, source.TargetRpe);
        if (own == goal) return false;
        return !(own is { } previous && goal is { } current && Math.Abs(previous - current) <= TaperReserve &&
                 Reserve(source) is { } reserve && reserve >= current);
    }

    /// A planned deload is far easier than the current target and says nothing about working capacity.
    public static bool IsDeload(SetExposure exposure, double? goal)
        => exposure.HasPrescription && goal is { } target && Reserve(exposure.TargetRir, exposure.TargetRpe) is { } own &&
           own >= target + TaperReserve + 1;

    // A local load/reps heuristic, deliberately separate from PR/e1RM reporting. It is used
    // only up to 30 effective reps, and never claimed to guarantee the prescribed effort.
    // An unrecorded reserve is taken as the one assumed for it (the target the set was asked for),
    // never as failure: reading it as zero would rate every unrated set weaker than it was.
    public static double? Capacity(SetExposure source, double? load, double? assumedReserve = null)
    {
        var reserve = Reserve(source) ?? assumedReserve ?? 0;
        return load is > 0 && source.Reps is > 0 && source.Reps + reserve <= 30
            ? load * (30 + source.Reps + reserve) : null;
    }

    /// The reserve a set is read with: the one it logged, else the target it was performed against,
    /// else the target now asked for. Null when none of them is known.
    public static double? AssumedReserve(SetExposure source, double? goal)
        => Reserve(source) ?? Reserve(source.TargetRir, source.TargetRpe) ?? goal;

    /// The reps the set allows at a new load, kept at the same effort: the target when one is set,
    /// else the reserve the set itself logged. A set with no recorded effort is assumed to have met
    /// its target, so the estimate moves only with the load.
    public static int? RepsAt(SetExposure source, double? oldLoad, double newLoad, double? goal)
    {
        if (newLoad <= 0 || Capacity(source, oldLoad, AssumedReserve(source, goal)) is not { } capacity) return null;
        return (int)Math.Floor(capacity / newLoad - 30 - (goal ?? AssumedReserve(source, null) ?? 0) + 1e-9);
    }

    public static int Streak(IEnumerable<SetExposure> history, Func<SetExposure, bool> predicate)
        => history.TakeWhile(predicate).Count();
}
