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
        var working = history.Where(exposure => !ProgressionEvidence.IsDeload(exposure, goal)).ToList();
        if (working.Count == 0) return history;

        var matched = working.Where(exposure => !ProgressionEvidence.Changed(exposure, min, max, goal)).ToList();
        if (matched.Count == 0 || matched.Count == working.Count) return working;
        return (working[0].CompletedAt - matched[0].CompletedAt).TotalDays <= MatchWindowDays ? matched : working;
    }
}
