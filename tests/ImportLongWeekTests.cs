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
    public void Pure_bodybuilding_ten_day_cycles_keep_their_printed_weeks_and_source_order()
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
        Assert.Equal(Enumerable.Range(1, 10), result.Workouts.Select(day => day.Week).Distinct().Order());
        Assert.All(result.Workouts.GroupBy(day => day.Week), week => Assert.Equal(10, week.Count()));
        Assert.Equal(10, result.SourceWeekDays);
        Assert.Equal(source.Select(day => day.SourcePage), result.Workouts.Select(day => day.SourcePage));
        Assert.Equal(["Pull #1", "Push #1", "Legs #1", "Arms & Weak Points #1", "Rest Day",
                "Pull #2", "Push #2", "Legs #2", "Arms & Weak Points #2", "Rest Day"],
            result.Workouts.Where(day => day.Week == 1).Select(day => day.Name));

        var block2Start = result.Workouts.Single(day => day.SourcePage == 46 && day.Name == "Pull #1");
        Assert.Equal(6, block2Start.Week);
        Assert.Equal(1, block2Start.PhaseWeek);
        Assert.Single(result.Notices, notice => notice.Code == "long_source_cycle_reflowed");
        Assert.DoesNotContain(ImportValidation.ReviewIssues(new ImportDraft("Pure Bodybuilding", result.Workouts, result.SourceWeekDays)),
            issue => issue.Code == "week_day_overflow");
        // Without the source's confirmation, a ten-day week is still reported.
        Assert.Contains(ImportValidation.ReviewIssues(new ImportDraft("Pure Bodybuilding", result.Workouts)),
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

    [Theory]
    [InlineData("The workouts follow a 10-day rotation with eight sessions and two rests.")]
    [InlineData("Run this asynchronous 10 day split before repeating it.")]
    [InlineData("Each 10-day cycle repeats in source order.")]
    public void Alternate_printed_phrases_identify_a_ten_day_cycle(string source)
    {
        Assert.True(ImportLongWeeks.IsTenDayCycleSource([new ImportPageText(2, source)]));
    }

    [Fact]
    public void A_repeated_week_number_in_a_new_block_does_not_create_a_false_long_week()
    {
        var pages = new List<ImportPageText>
        {
            new(1, "BLOCK 1\nWEEK 1\nDAY LABEL: Day 1\nDAY LABEL: Day 2\nDAY LABEL: Day 3\nDAY LABEL: Day 4\nDAY LABEL: Day 5\nREST DAY\nREST DAY"),
            new(2, "BLOCK 2\nWEEK 1\nDAY LABEL: Day 1\nDAY LABEL: Day 2\nDAY LABEL: Day 3\nDAY LABEL: Day 4\nDAY LABEL: Day 5\nREST DAY\nREST DAY")
        };

        Assert.False(ImportLongWeeks.HasSourceLongWeek(pages));
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
        Assert.All(result.Workouts, day => Assert.Equal(1, day.Week));
        Assert.Equal(10, result.SourceWeekDays);
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

        Assert.Equal([1, 1, 1, 1, 1, 1, 1, 1, 2], result.Workouts.Select(day => day.Week));
        Assert.Single(result.Notices, issue => issue.Code == "long_source_week_kept");
    }

    [Fact]
    public void Source_backed_optional_and_rest_slots_reflow_without_discarding_the_next_week()
    {
        var days = new List<DraftWorkout>
        {
            Training(1, 1, "Block 1", "Day 1", 1),
            Training(1, 1, "Block 1", "Day 2", 2),
            Rest(1, 2),
            Training(1, 1, "Block 1", "Day 3", 3),
            Rest(1, 3),
            Training(1, 1, "Block 1", "Day 4", 4),
            Training(1, 1, "Block 1", "Day 5 Optional", 5),
            Rest(1, 5),
            Training(2, 2, "Block 1", "Next week", 6)
        };
        var pages = Enumerable.Range(1, 6).Select(page => new ImportPageText(page,
            $"WEEK {(page == 6 ? 2 : 1)}\nDAY LABEL: {(page == 6 ? "Next week" : page == 5 ? "Day 5 Optional" : $"Day {page}")}" +
            (page is 2 or 3 or 5 ? "\nREST DAY" : ""))).ToList();

        Assert.True(ImportLongWeeks.HasSourceLongWeek(pages));
        var shaped = ImportDayShape.Reconcile(days.Take(8), ImportLongWeeks.HasSourceLongWeek(pages));
        Assert.Equal(8, shaped.Workouts.Count);
        var result = ImportLongWeeks.Reconcile(days, pages);

        Assert.Equal(days.Count, result.Workouts.Count);
        Assert.Equal(3, result.Workouts.Count(day => day.IsRestDay));
        Assert.Equal([1, 1, 1, 1, 1, 1, 1, 1, 2], result.Workouts.Select(day => day.Week));
        Assert.Equal(8, result.SourceWeekDays);
        Assert.Contains(result.Notices, issue => issue.Code == "long_source_week_kept");
    }

    [Fact]
    public void Optional_rest_day_bands_are_source_evidence_for_a_long_printed_week()
    {
        var days = new List<DraftWorkout>();
        var pages = new List<ImportPageText>();
        for (var page = 1; page <= 8; page++)
        {
            var name = $"Day {page}";
            days.Add(Training(1, 1, "Block 1", name, page));
            var restBand = page is 2 or 4 or 6 or 8 ? "\nOptional Rest Day" : "";
            pages.Add(new ImportPageText(page, $"WEEK 1\nDAY LABEL: {name}{restBand}"));
            if (restBand.Length > 0) days.Add(Rest(1, page));
        }

        Assert.True(ImportLongWeeks.HasSourceLongWeek(pages));
        var result = ImportLongWeeks.Reconcile(days, pages);

        Assert.Equal(12, result.Workouts.Count);
        Assert.Equal(4, result.Workouts.Count(day => day.IsRestDay));
        Assert.All(result.Workouts, day => Assert.Equal(1, day.Week));
        Assert.Equal(12, result.SourceWeekDays);
        Assert.Single(result.Notices, issue => issue.Code == "long_source_week_kept");
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
