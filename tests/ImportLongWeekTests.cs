using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportLongWeekTests
{
    private static readonly string[] SessionNames =
    [
        "Pull #1", "Push #1", "Legs #1", "Arms & Weak Points #1",
        "Pull #2", "Push #2", "Legs #2", "Arms & Weak Points #2"
    ];

    [Fact]
    public void Source_confirmed_ten_day_cycles_keep_both_rest_days_and_fit_program_weeks()
    {
        var source = new List<DraftWorkout>();
        var pages = new List<ImportPageText>();
        var page = 6;
        for (var printedWeek = 1; printedWeek <= 10; printedWeek++)
        {
            var block = printedWeek <= 5 ? "Block 1" : "Block 2";
            for (var index = 0; index < SessionNames.Length; index++)
            {
                var name = SessionNames[index];
                source.Add(Training(printedWeek, printedWeek <= 5 ? printedWeek : printedWeek - 5,
                    block, name, page));
                pages.Add(new ImportPageText(page, $"WEEK {printedWeek}\nDAY LABEL: {name}"));
                if (index is 3 or 7)
                    source.Add(new DraftWorkout(Guid.NewGuid(), printedWeek, "Rest Day", null, null, [],
                        block, "Build", printedWeek <= 5 ? printedWeek : printedWeek - 5, true, page));
                page++;
            }
        }

        var shaped = ImportDayShape.Reconcile(source);
        Assert.Equal(100, shaped.Workouts.Count);
        Assert.DoesNotContain(shaped.Notices, notice => notice.Code == "trailing_rest_day_trimmed");

        var result = ImportLongWeeks.Reconcile(shaped.Workouts, pages);

        Assert.Equal(100, result.Workouts.Count);
        Assert.Equal(20, result.Workouts.Count(day => day.IsRestDay));
        Assert.Equal(16, result.Workouts.Max(day => day.Week));
        Assert.All(result.Workouts.GroupBy(day => day.Week), week => Assert.InRange(week.Count(), 1, 7));
        Assert.Equal(source.Select(day => day.LineId), result.Workouts.Select(day => day.LineId));
        Assert.Equal([1, 2, 3, 4, 5, 6, 7, 8], result.Workouts.Where(day => day.Block == "Block 1")
            .Select(day => day.PhaseWeek).Distinct());
        Assert.Equal(2, result.Notices.Count);
        Assert.DoesNotContain(ImportValidation.ReviewIssues(new ImportDraft("Pure Bodybuilding", result.Workouts)),
            issue => issue.Code == "week_day_overflow");
    }

    [Fact]
    public void Ambiguous_extra_day_without_its_own_printed_label_remains_for_review()
    {
        var source = Enumerable.Range(1, 8).Select(index => Training(1, 1, "Block 1", $"Day {index}", index)).ToList();
        var pages = Enumerable.Range(1, 7)
            .Select(index => new ImportPageText(index, $"WEEK 1\nDAY LABEL: Day {index}"))
            .ToList();

        var result = ImportLongWeeks.Reconcile(source, pages);

        Assert.All(result.Workouts, day => Assert.Equal(1, day.Week));
        Assert.Empty(result.Notices);
        Assert.Contains(ImportValidation.ReviewIssues(new ImportDraft("Ambiguous", result.Workouts)),
            issue => issue.Code == "week_day_overflow");
    }

    [Fact]
    public void Repeated_session_names_on_separate_printed_pages_still_form_a_long_cycle()
    {
        var source = Enumerable.Range(1, 8).Select(index =>
            Training(1, 1, "Block 1", index % 2 == 0 ? "Lower" : "Upper", index)).ToList();
        source.Insert(4, new DraftWorkout(Guid.NewGuid(), 1, "Rest Day", null, null, [],
            "Block 1", "Build", 1, true, 4));
        source.Add(new DraftWorkout(Guid.NewGuid(), 1, "Rest Day", null, null, [],
            "Block 1", "Build", 1, true, 8));
        var pages = Enumerable.Range(1, 8).Select(index => new ImportPageText(index,
            $"WEEK 1\nDAY LABEL: {(index % 2 == 0 ? "Lower" : "Upper")}")).ToList();

        var shaped = ImportDayShape.Reconcile(source);
        var result = ImportLongWeeks.Reconcile(shaped.Workouts, pages);

        Assert.Equal(10, result.Workouts.Count);
        Assert.Equal(2, result.Workouts.Count(day => day.IsRestDay));
        Assert.Equal(2, result.Workouts.Max(day => day.Week));
        Assert.Single(result.Notices);
    }

    [Fact]
    public void One_long_week_does_not_compress_other_source_weeks_in_the_phase()
    {
        var source = SessionNames.Select((name, index) => Training(1, 1, "Block 1", name, index + 1))
            .Append(Training(2, 2, "Block 1", "Day from week 2", 9)).ToList();
        var pages = source.Select(day => new ImportPageText(day.SourcePage!.Value,
            $"WEEK {day.Week}\nDAY LABEL: {day.Name}")).ToList();

        var result = ImportLongWeeks.Reconcile(source, pages);

        Assert.Equal(source.Select(day => day.Week), result.Workouts.Select(day => day.Week));
        Assert.Empty(result.Notices);
    }

    private static DraftWorkout Training(int week, int phaseWeek, string block, string name, int page)
        => new(Guid.NewGuid(), week, name, null, null,
            [new DraftExercise(Guid.NewGuid(), "Squat", null, null,
                [new DraftSet(8, 10, 8, 90, null, null, null)], SourcePage: page)],
            block, "Build", phaseWeek, false, page);
}
