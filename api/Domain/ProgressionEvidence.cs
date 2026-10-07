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

    public static bool Hard(SetExposure exposure, int minimum, double? goal)
        => goal is { } target && Reserve(exposure) is { } reserve
            ? reserve <= target - 1
            : goal is null && exposure.Reps < minimum && !exposure.IsRepRangeTransition;

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
