namespace Workout.Api.Services;

/// A phase's relative weeks are a numbering convention: the order is the absolute weeks. An editor
/// numbers a phase by its label while the server splits it into runs of neighbouring days (a
/// deload week that labels its training days but not its rest days is several runs), so the two
/// rarely agree after a deletion or a move. The server settles it by counting each run from one
/// before it validates, the same way an import draft is numbered.
internal static class ProgramPhaseNumbering
{
    public static List<ProgramWorkoutInput> Number(IReadOnlyList<ProgramWorkoutInput> workouts)
    {
        var numbered = new Dictionary<ProgramWorkoutInput, int>(ReferenceEqualityComparer.Instance);
        foreach (var phase in ProgramService.GroupPhases(workouts))
        {
            var positions = phase.Select(day => day.PhaseWeek).Distinct().Order()
                .Select((week, index) => (week, position: index + 1)).ToDictionary(item => item.week, item => item.position);
            foreach (var day in phase) numbered[day] = positions[day.PhaseWeek];
        }
        return [.. workouts.Select(day => numbered.TryGetValue(day, out var week) && week != day.PhaseWeek
            ? day with { PhaseWeek = week }
            : day)];
    }
}
