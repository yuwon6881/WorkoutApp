using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportOptionalScheduleDayTests
{
    [Fact]
    public void Explicit_optional_day_is_placed_in_every_printed_target_week()
    {
        var workouts = new List<DraftWorkout>();
        var pages = new List<ImportPageText>();
        for (var week = 1; week <= 11; week++)
        {
            for (var dayIndex = 1; dayIndex <= 4; dayIndex++)
            {
                var page = (week - 1) * 4 + dayIndex;
                var name = $"Week {week} Day {dayIndex}";
                workouts.Add(Training(week, name, page, phaseWeek: 1));
                pages.Add(new ImportPageText(page, $"WEEK {week}\nDAY LABEL: {name}"));
            }
        }

        const int optionalPage = 71;
        workouts.Add(Training(11, "Full Body 5: Arm & Pump Day", optionalPage, phaseWeek: 11));
        pages.Add(new ImportPageText(optionalPage,
            "ARM & HYPERTROPHY DAY: OPTIONALLY RUN THIS DAY ON THE ODD WEEKS (WEEK 1, 3, 5, 7 AND 9) IF YOU HAVE AN EXTRA DAY TO TRAIN.\n" +
            "DAY LABEL: FULL BODY 5: ARM & PUMP DAY"));

        var result = ImportLongWeeks.Reconcile(workouts, pages);
        var optionalDays = result.Workouts.Where(day => day.SourcePage == optionalPage).OrderBy(day => day.Week).ToList();

        Assert.Equal([1, 3, 5, 7, 9], optionalDays.Select(day => day.Week));
        Assert.Equal([1, 1, 1, 1, 1], optionalDays.Select(day => day.PhaseWeek));
        Assert.Equal(5, optionalDays.Select(day => day.LineId).Distinct().Count());
        Assert.Equal(5, optionalDays.SelectMany(day => day.Exercises).Select(exercise => exercise.LineId).Distinct().Count());
        Assert.All(optionalDays, day =>
        {
            Assert.Equal("Full Body 5: Arm & Pump Day", day.Name);
            Assert.Contains("Optional session printed for weeks 1, 3, 5, 7, 9.", day.Notes);
            Assert.All(day.Exercises, exercise => Assert.Equal(optionalPage, exercise.SourcePage));
        });
        Assert.DoesNotContain(ImportValidation.ReviewIssues(new ImportDraft("Program", result.Workouts)),
            issue => issue.Code == "week_day_overflow");
        var phaseWeeks = ImportValidation.GroupDraftPhases(result.Workouts)
            .SelectMany(phase => phase.Select(day => day.PhaseWeek).Distinct().Order())
            .Distinct().Order().ToList();
        Assert.Equal(Enumerable.Range(1, phaseWeeks.Count), phaseWeeks);
        Assert.Single(result.Notices, notice => notice.Code == "optional_source_day_scheduled");
    }

    private static DraftWorkout Training(int week, string name, int page, int? phaseWeek = null)
        => new(Guid.NewGuid(), week, name, null, null,
            [new DraftExercise(Guid.NewGuid(), "Barbell Curl", null, null,
                [new DraftSet(8, 10, 8, 90, null, null, null, SourcePage: page)], SourcePage: page)],
            "Block 1", "Build", phaseWeek ?? week, false, page);
}
