using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Powerbuilding 3.0 ends on "WEEK 10A" and "WEEK 10B": two max-testing weeks of which the
/// document asks for one. Both were read as week 10, so that week held twelve days, overflowed
/// the seven a week holds, and its six "REST DAY" rows were reported as days read twice.
public sealed class ImportWeekVersionTests
{
    private static readonly List<ImportPageText> Pages =
    [
        new(63, "WEEK 9\nDAY LABEL: FULL BODY 1\nWEEK 9\nEXERCISE | WARM-UP SETS | WORKING SETS\nBACK SQUAT | 4 | 1"),
        new(66, "POWERBUILDING 3.0 - JEFF NIPPARD\nWEEK 10A\nMAX TESTING OPTION A: IMPORTANT! CHOOSE EITHER WEEK 10A OR WEEK 10B.\n" +
            "DAY LABEL: SQUAT TEST\nWEEK 10A\nEXERCISE | WARM-UP SETS | WORKING SETS\nBACK SQUAT | 5 | 1+\nREST DAY"),
        new(68, "POWERBUILDING 3.0 - JEFF NIPPARD\nWEEK 10B\nMAX TESTING OPTION B: IMPORTANT! CHOOSE EITHER WEEK 10A OR WEEK 10B.\n" +
            "DAY LABEL: SQUAT TEST\nWEEK 10B\nEXERCISE | WARM-UP SETS | WORKING SETS\nBACK SQUAT | 5 | 1\nREST DAY"),
        new(70, "WEEK 11\nDAY LABEL: FULL BODY 1\nWEEK 11 | EXERCISE | WARM-UP SETS | WORKING SETS\nDEADLIFT | 4 | 2")
    ];

    [Fact]
    public void Each_lettered_version_of_a_week_becomes_its_own_week_and_later_weeks_move_along()
    {
        List<DraftWorkout> days =
        [
            Training(9, "Full Body 1", 63),
            .. TestingWeek(10, 66), .. TestingWeek(10, 68),
            Training(11, "Full Body 1", 70)
        ];

        var result = ImportWeekVariants.Separate(days, Pages);

        Assert.Equal([9, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 12], result.Workouts.Select(day => day.Week));
        Assert.All(result.Workouts.Where(day => day.SourcePage == 68), day => Assert.Equal(11, day.Week));
        var notice = Assert.Single(result.Notices);
        Assert.Equal(ImportWeekVariants.Code, notice.Code);
        Assert.Equal("info", notice.Severity);
        Assert.Contains("10A, 10B", notice.Message);
        Assert.Contains("weeks 10, 11", notice.Message);
        Assert.Equal(6, result.Moved.Count);
    }

    [Fact]
    public void A_week_printed_once_is_left_alone_even_when_prose_names_both_versions()
    {
        var pages = new List<ImportPageText>
        {
            new(64, "WEEK 10\nRUN WEEK 10A ONLY IF YOU HAVE COMPETITIVE POWERLIFTING GOALS\nRUN WEEK 10B OTHERWISE"),
            Pages[1]
        };
        var days = TestingWeek(10, 66).ToList();

        var result = ImportWeekVariants.Separate(days, pages);

        Assert.All(result.Workouts, day => Assert.Equal(10, day.Week));
        Assert.Empty(result.Notices);
    }

    [Fact]
    public void Option_headings_keep_two_source_backed_versions_separate()
    {
        var pages = new List<ImportPageText>
        {
            new(66, "WEEK 10 - OPTION A\nDAY LABEL: SQUAT TEST"),
            new(68, "WEEK 10 (OPTION B)\nDAY LABEL: SQUAT TEST")
        };
        var days = TestingWeek(10, 66).Concat(TestingWeek(10, 68)).ToList();

        var result = ImportWeekVariants.Separate(days, pages);

        Assert.Equal(6, result.Workouts.Count(day => day.Week == 10));
        Assert.Equal(6, result.Workouts.Count(day => day.Week == 11));
        Assert.Single(result.Notices, notice => notice.Code == ImportWeekVariants.Code);
    }

    [Fact]
    public void A_section_holding_both_versions_neither_overflows_the_week_nor_reports_its_rest_days_as_repeats()
    {
        var extracted = new ImportDraft("Powerbuilding 3.0", [.. TestingWeek(10, 66), .. TestingWeek(10, 68)]);
        var chunk = new ImportChunk("Week 10 Max Testing", null, null, 10, 10, 66, 68, 6);

        var merge = ImportChunkReconciliation.ReconcileChunkCoverage(new ImportDraft("Powerbuilding 3.0", []), extracted, chunk, Pages);

        Assert.Equal(12, merge.Workouts.Count);
        Assert.All(merge.Workouts.GroupBy(day => day.Week), week => Assert.Equal(6, week.Count()));
        Assert.DoesNotContain(merge.Notices, issue => issue.Code is "repeated_day" or "trailing_rest_day_trimmed" or "day_outside_section_weeks");
        Assert.Contains(merge.Notices, issue => issue.Code == ImportWeekVariants.Code);
        Assert.DoesNotContain(ImportValidation.ReviewIssues(new ImportDraft("Powerbuilding 3.0", merge.Workouts)),
            issue => issue.Code == "week_day_overflow");
    }

    private static IEnumerable<DraftWorkout> TestingWeek(int week, int page)
    {
        foreach (var name in new[] { "Squat Test", "Bench Test", "Deadlift Test" })
        {
            yield return Training(week, name, page);
            yield return new DraftWorkout(Guid.NewGuid(), week, "Rest Day", null, null, [], IsRestDay: true, SourcePage: page);
        }
    }

    private static DraftWorkout Training(int week, string name, int page)
        => new(Guid.NewGuid(), week, name, null, null,
            [new DraftExercise(Guid.NewGuid(), "Back Squat", null, null, [new DraftSet(1, 1, 9.5, 300, null, null, null, SourcePage: page)], SourcePage: page)],
            SourcePage: page);
}
