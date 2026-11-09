using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportAlternativeSelectionTests
{
    [Theory]
    [InlineData("week-a", 66, 68)]
    [InlineData("week-b", 68, 66)]
    public void Selection_keeps_common_days_and_chosen_version_then_closes_week_gaps(string id, int keptPage, int omittedPage)
    {
        DraftWorkout Day(int week, int page) => new(Guid.NewGuid(), week, "Training", null, null, [], PhaseWeek: week, SourcePage: page);
        var before = Day(9, 63);
        var a = Day(10, 66);
        var b = Day(11, 68);
        var after = Day(12, 70);
        List<ImportAlternative> options = [
            new("week-a", "Week 10A", 1, Kind: ImportAlternativeKinds.Week, DayLineIds: [a.LineId]),
            new("week-b", "Week 10B", 1, Kind: ImportAlternativeKinds.Week, DayLineIds: [b.LineId])
        ];

        var draft = new ImportDraft("Program", [before, a, b, after]) { AlternativeGroups = [new ImportAlternativeGroup("versions", options)] };

        var result = ImportDraftAlternatives.Select(draft, id, "versions");

        Assert.Equal([9, 10, 11], result.Workouts.Select(day => day.Week));
        Assert.Equal([9, 10, 11], result.Workouts.Select(day => day.PhaseWeek));
        Assert.Equal([63, keptPage, 70], result.Workouts.Select(day => day.SourcePage));
        Assert.DoesNotContain(result.Workouts, day => day.SourcePage == omittedPage);
        Assert.Equal([before.LineId, id == "week-a" ? a.LineId : b.LineId, after.LineId], result.Workouts.Select(day => day.LineId));
    }
}
