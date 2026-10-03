namespace Workout.Api.Domain;

/// The logged and prescribed effort of one earlier working set in the same exercise and session.
public sealed record SetEffort(string? Rir, double? Rpe, string? TargetRir, double? TargetRpe);

/// What the earlier sets of a session left behind for the set that follows them. Overshoot is the
/// most reserve reps any earlier set went past its own target; Reserve is the lowest reserve logged.
public sealed record EarlierEffort(double? Overshoot, double? Reserve);

/// How carried-over fatigue reads one set's history. Excused exposures are dips their earlier sets
/// explain. Fresh is the latest older exposure whose earlier sets were not pushed, describing what
/// the set does when it starts fresh; it is set only when the newest exposure is excused.
internal sealed record FatigueReading(IReadOnlySet<SetExposure> Excused, SetExposure? Fresh, bool PastTarget)
{
    public static readonly FatigueReading None = new(new HashSet<SetExposure>(), null, false);
}

/// Fatigue carried from earlier sets of the same exercise. A second set that falls short after the
/// first was taken past its target effort, or closer to failure than the comparable session, shows
/// what the first set cost, not lost strength. Such a dip is not read as a hard or failed exposure
/// of the later set, and its plan is compared with the latest session where it started fresh.
public static class ProgressionFatigue
{
    /// A dip is excused at most this many sessions running: one that keeps recurring is real evidence.
    public const int MaxExcusedSessions = 2;

    /// The smallest overshoot, in reserve reps, that explains a later set's dip.
    private const double Pushed = 1;

    public static EarlierEffort Before(IEnumerable<SetEffort> earlier)
    {
        double? overshoot = null;
        double? lowest = null;
        foreach (var set in earlier)
        {
            if (ProgressionEvidence.Reserve(set.Rir, set.Rpe) is not { } reserve) continue;
            lowest = lowest is null ? reserve : Math.Min(lowest.Value, reserve);
            if (ProgressionEvidence.Reserve(set.TargetRir, set.TargetRpe) is { } target)
                overshoot = overshoot is null ? target - reserve : Math.Max(overshoot.Value, target - reserve);
        }
        return new EarlierEffort(overshoot, lowest);
    }

    /// Reads a newest-first history. Nothing is excused once the newest dips run past the excuse
    /// limit, so a persistent shortfall is handled as an ordinary one.
    internal static FatigueReading Read(IReadOnlyList<SetExposure> history, int? minimum, double? goal,
        Func<SetExposure, double?> selector)
    {
        if (history.Count == 0) return FatigueReading.None;
        var excused = new HashSet<SetExposure>(ReferenceEqualityComparer.Instance);
        var pushed = new bool[history.Count];
        var references = new SetExposure?[history.Count];
        // Oldest first, so each exposure is compared with the newest older one that started fresh.
        for (var index = history.Count - 1; index >= 0; index--)
        {
            var exposure = history[index];
            var reference = references[index] = Reference(history, pushed, index);
            pushed[index] = IsPushed(exposure, reference);
            if (pushed[index] && Dipped(exposure, reference, minimum, goal, selector)) excused.Add(exposure);
        }
        if (history.TakeWhile(excused.Contains).Count() > MaxExcusedSessions) return FatigueReading.None;
        var newestExcused = excused.Contains(history[0]);
        return new FatigueReading(excused, newestExcused ? references[0] : null,
            newestExcused && history[0].PriorOvershoot is >= Pushed);
    }

    private static SetExposure? Reference(IReadOnlyList<SetExposure> history, bool[] pushed, int index)
    {
        for (var older = index + 1; older < history.Count; older++)
            if (!pushed[older]) return history[older];
        return null;
    }

    private static bool IsPushed(SetExposure exposure, SetExposure? reference)
        => exposure.PriorOvershoot is >= Pushed ||
           exposure.PriorReserve is { } now && reference?.PriorReserve is { } before && before - now >= Pushed;

    private static bool Dipped(SetExposure exposure, SetExposure? reference, int? minimum, double? goal,
        Func<SetExposure, double?> selector)
    {
        if (exposure.Reps is not { } reps) return false;
        if (ProgressionEvidence.Hard(exposure, minimum ?? 0, goal)) return true;
        if (minimum is { } floor && reps < floor) return true;
        return reference?.Reps is { } fresh && reps < fresh &&
               ProgressionEvidence.SameLoad(selector(exposure), selector(reference));
    }
}
