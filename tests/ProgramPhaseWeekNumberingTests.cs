using Workout.Api.Services;
using Xunit;
using static Workout.Tests.ProgramEditRig;

namespace Workout.Tests;

/// A phase-relative week is a numbering convention, so a save must never be refused because an
/// editor numbered a phase differently from the way the server splits it into runs of days.
public class ProgramPhaseWeekNumberingTests
{
    // A deload week labels its training days but not its rest days, so the server sees one week as
    // several runs of days; the numbering an editor writes after a deletion rarely matches that.
    private static ProgramWorkoutInput Labelled(int week, string name, Guid exercise, int phaseWeek)
        => Train(week, name, exercise, phaseWeek, phase: "Semi-Deload");

    private static List<ProgramWorkoutInput> MixedWeeks(Guid bench, Func<int, int> phaseWeek) =>
    [
        .. Enumerable.Range(1, 3).SelectMany(week => new[]
        {
            Labelled(week, $"W{week} A", bench, phaseWeek(week)), Labelled(week, $"W{week} B", bench, phaseWeek(week)),
            Rest(week, $"W{week} Rest", phaseWeek(week)), Labelled(week, $"W{week} C", bench, phaseWeek(week))
        })
    ];

    [Fact]
    public async Task A_program_numbered_with_gaps_is_created_with_every_phase_counting_from_one()
    {
        await using var rig = await Ready();

        var program = await rig.H.Programs.Create(new ProgramInput("Gappy", MixedWeeks(rig.Bench, week => week * 2)),
            activate: false, null, default);

        Assert.All(program.Workouts, day => Assert.True(day.PhaseWeek >= 1));
        Assert.Contains(program.Workouts, day => day.PhaseWeek == 1);
    }

    [Fact]
    public async Task Deleting_a_day_from_a_mixed_phase_week_saves_when_the_editor_numbers_phases_by_label()
    {
        await using var rig = await Ready();
        var program = await rig.H.Programs.Create(new ProgramInput("Mixed", MixedWeeks(rig.Bench, _ => 1)),
            activate: false, null, default);
        var removed = Day(program, "W2 C").Id;

        // What the editor sends: every day renumbered by its label, rest days counting weeks on their own.
        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days => days
            .Where(day => day.Id != removed)
            .Select(day => day with { PhaseWeek = day.Week }).ToList()), default);

        Assert.Equal(program.Workouts.Count - 1, edited.Workouts.Count);
    }

    [Fact]
    public async Task A_second_save_of_the_same_program_changes_nothing()
    {
        await using var rig = await Ready();
        var program = await rig.H.Programs.Create(new ProgramInput("Stable", MixedWeeks(rig.Bench, week => week)),
            activate: false, null, default);

        var again = await rig.H.ProgramEditor.UpdateProgram(program.Id, Unchanged(program), default);

        Assert.Equal(program.Revision, again.Revision);
    }
}
