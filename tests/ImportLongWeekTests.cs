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
    public void Pure_bodybuilding_ten_day_cycles_keep_source_order_and_split_seven_plus_three()
    {
        var source = new List<DraftWorkout>();
        var pages = new List<ImportPageText>
        {
            new(2, "This asynchronous split runs on a 10-day cycle instead of the usual 7-day cycle.")
        };
        var page = 6;
        for (var printedWeek = 1; printedWeek <= 10; printedWeek++)
        {
            var block = printedWeek <= 5 ? "Block 1" : "Block 2";
            var localWeek = printedWeek <= 5 ? printedWeek : printedWeek - 5;
            for (var index = 0; index < SessionNames.Length; index++)
            {
                var name = SessionNames[index];
                // Block 2 restarts its model-local week count. A recycled Block 1 banner is
                // present on a later Block 2 page, but printed week headings define the cycle.
                var sourceBlock = printedWeek == 6 && index == 4 ? "Block 1" : block;
                var banner = printedWeek == 6 && index == 4 ? "BLOCK 1\n" : "";
                var restBand = index is 3 or 7 ? "\n1-2 Rest Days" : "";
                source.Add(Training(localWeek, localWeek, sourceBlock, name, page));
                pages.Add(new ImportPageText(page, $"{banner}WEEK {printedWeek}\nDAY LABEL: {name}{restBand}"));
                if (index is 3 or 7)
                    source.Add(new DraftWorkout(Guid.NewGuid(), localWeek, "Rest Day", null, null, [],
                        sourceBlock, "Build", localWeek, true, page));
                page++;
            }
        }

        var result = ImportLongWeeks.Reconcile(source, pages);

        Assert.Equal(100, result.Workouts.Count);
        Assert.Equal(20, result.Workouts.Count(day => day.IsRestDay));
        Assert.Equal(20, result.Workouts.Select(day => day.Week).Distinct().Count());
        Assert.Equal(20, result.Workouts.Max(day => day.Week));
        Assert.All(result.Workouts.GroupBy(day => day.Week), week => Assert.InRange(week.Count(), 1, 7));
        Assert.All(result.Workouts.GroupBy(day => day.Week), week =>
            Assert.Equal(week.Key % 2 == 1 ? 7 : 3, week.Count()));
        Assert.Equal(source.Select(day => day.SourcePage), result.Workouts.Select(day => day.SourcePage));
        Assert.Equal(["Pull #1", "Push #1", "Legs #1", "Arms & Weak Points #1", "Rest Day", "Pull #2", "Push #2"],
            result.Workouts.Where(day => day.Week == 1).Select(day => day.Name));
        Assert.Equal(["Legs #2", "Arms & Weak Points #2", "Rest Day"],
            result.Workouts.Where(day => day.Week == 2).Select(day => day.Name));

        var block2Start = result.Workouts.Single(day => day.SourcePage == 46 && day.Name == "Pull #1");
        Assert.Equal(11, block2Start.Week);
        Assert.Equal("Legs #2", result.Workouts.First(day => day.Week == 12).Name);
        Assert.Equal(2, result.Workouts.First(day => day.Week == 12).PhaseWeek);
        Assert.Single(result.Notices, notice => notice.Code == "long_source_cycle_reflowed");
        Assert.DoesNotContain(ImportValidation.ReviewIssues(new ImportDraft("Pure Bodybuilding", result.Workouts)),
            issue => issue.Code == "week_day_overflow");
    }

    [Fact]
    public void Chunk_cleanup_preserves_rest_rows_for_an_explicit_ten_day_cycle()
    {
        var days = Enumerable.Range(1, 8).Select(index => Training(1, 1, "Block 1", $"Day {index}", index)).ToList();
        days.Insert(4, Rest(1, 4));
        days.Add(Rest(1, 8));

        var shaped = ImportDayShape.Reconcile(days, preserveTrailingRestDays: true);

        Assert.Equal(10, shaped.Workouts.Count);
        Assert.Equal(2, shaped.Workouts.Count(day => day.IsRestDay));
        Assert.DoesNotContain(shaped.Notices, notice => notice.Code == "trailing_rest_day_trimmed");
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
        source.Insert(4, Rest(1, 4));
        source.Add(Rest(1, 8));
        var pages = Enumerable.Range(1, 8).Select(index => new ImportPageText(index,
            $"WEEK 1\nDAY LABEL: {(index % 2 == 0 ? "Lower" : "Upper")}" + (index is 4 or 8 ? "\n1-2 Rest Days" : ""))).ToList();

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

    private static DraftWorkout Rest(int week, int page)
        => new(Guid.NewGuid(), week, "Rest Day", null, null, [],
            "Block 1", "Build", 1, true, page);
}
