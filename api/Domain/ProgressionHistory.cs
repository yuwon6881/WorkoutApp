namespace Workout.Api.Domain;

/// Chooses which past exposures describe the set being planned. Two things pollute a plain
/// newest-first list: a planned deload week, and another day that trains the same movement in a
/// different rep range. Neither is a failed or repeated exposure of this prescription.
internal static class ProgressionHistory
{
    // Heavy/light days alternate within roughly a week; anything older is a past program phase.
    private const double MatchWindowDays = 14;

    public static IReadOnlyList<SetExposure> Prepare(IReadOnlyList<SetExposure> history, int? min, int? max, double? goal)
    {
        history = OnePerSession(history, min, max, goal);
        var working = history.Where(exposure => !ProgressionEvidence.IsDeload(exposure, goal)).ToList();
        if (working.Count == 0) return history;

        var matched = working.Where(exposure => !ProgressionEvidence.Changed(exposure, min, max, goal)).ToList();
        if (matched.Count == 0 || matched.Count == working.Count) return working;
        return (working[0].CompletedAt - matched[0].CompletedAt).TotalDays <= MatchWindowDays ? matched : working;
    }

    /// A session that trained the movement twice (a top set and back-off sets as separate rows)
    /// counts once: as the row prescribed like the set being planned, else the row whose rep range
    /// and effort come closest to it. Falling back to the first row read a back-off set from the
    /// top set (5 reps re-aimed at 8) while the next back-off set, which the top set never reached,
    /// read its own row, so the second back-off set came out heavier than the first.
    internal static IReadOnlyList<SetExposure> OnePerSession(IReadOnlyList<SetExposure> history, int? min, int? max, double? goal)
    {
        if (history.Select(exposure => exposure.SessionId).Distinct().Count() == history.Count) return history;
        return history.GroupBy(exposure => exposure.SessionId)
            .Select(session => session.FirstOrDefault(exposure => !ProgressionEvidence.Changed(exposure, min, max, goal)) ??
                session.OrderBy(exposure => Distance(exposure, min, max, goal)).First())
            .ToList();
    }

    // Rep range first, then target effort; OrderBy is stable, so ties keep the session's row order.
    private static double Distance(SetExposure exposure, int? min, int? max, double? goal)
    {
        if (!exposure.HasPrescription) return double.MaxValue;
        var reps = Math.Abs((exposure.RepMin ?? 0) - (min ?? 0)) + Math.Abs((exposure.RepMax ?? 0) - (max ?? 0));
        var own = ProgressionEvidence.Reserve(exposure.TargetRir, exposure.TargetRpe);
        var effort = own is { } previous && goal is { } current ? Math.Abs(previous - current) : own == goal ? 0 : 1;
        return reps * 10 + effort;
    }
}
