using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportReviewNoticesTests
{
    [Fact]
    public void Duplicate_notices_collapse_and_info_does_not_evict_a_warning()
    {
        var warning = new ImportReviewIssue("day_without_exercises", "Check this day.", "warning", 1, Guid.NewGuid());
        var lineId = Guid.NewGuid();
        var repeated = Enumerable.Range(1, 42)
            .Select(index => new ImportReviewIssue("day_name_from_source", $"Source title {index}.", "info", index, lineId))
            .ToList();

        var deduplicated = ImportReviewNotices.Merge([warning], repeated);

        Assert.Equal(2, deduplicated.Count);
        Assert.Contains(warning, deduplicated);
        Assert.Single(deduplicated, notice => notice.Code == "day_name_from_source" && notice.WorkoutLineId == lineId);

        var unique = Enumerable.Range(1, 42)
            .Select(index => new ImportReviewIssue("day_name_from_source", $"Source title {index}.", "info", index, Guid.NewGuid()));
        var capped = ImportReviewNotices.Merge([], unique.Prepend(warning));

        Assert.Equal(40, capped.Count);
        Assert.Contains(warning, capped);
    }

    [Fact]
    public void Every_actionable_notice_remains_visible_even_past_the_info_limit()
    {
        var warnings = Enumerable.Range(1, 42)
            .Select(index => new ImportReviewIssue("missing_source_day", $"Check day {index}.", "warning", index, Guid.NewGuid()))
            .ToList();

        var merged = ImportReviewNotices.Merge([], warnings);

        Assert.Equal(42, merged.Count);
    }

    [Fact]
    public void Section_issues_without_a_workout_id_remain_distinct_by_source_page()
    {
        var merged = ImportReviewNotices.Merge([], [
            new ImportReviewIssue("chunk_day_count", "Week 1 is short.", "warning", 10),
            new ImportReviewIssue("chunk_day_count", "Week 2 is short.", "warning", 20)
        ]);

        Assert.Equal(2, merged.Count);
    }

    [Fact]
    public void Printed_day_warning_clears_only_after_the_missing_source_page_is_restored()
    {
        var issue = new ImportReviewIssue("chunk_day_count", "One day is missing.", "warning", 10,
            TargetField: "week", ExpectedTrainingDays: 2, SourcePageTo: 11, WeekFrom: 1, WeekTo: 1);
        var day = new DraftWorkout(Guid.NewGuid(), 1, "Day 1", null, null, [], SourcePage: 10);
        var draft = new ImportDraft("Program", [day]);

        Assert.False(ImportReviewNotices.IsResolved(issue, draft));
        Assert.True(ImportReviewNotices.IsResolved(issue, draft with { Workouts = [day,
            day with { LineId = Guid.NewGuid(), Name = "Day 2", SourcePage = 11 }] }));
        Assert.False(ImportReviewNotices.IsResolved(issue, draft with { Workouts = [day,
            day with { LineId = Guid.NewGuid(), Name = "Wrong page", SourcePage = 20 }] }));
        Assert.True(ImportReviewNotices.IsResolved(issue, draft with { Workouts = [day,
            day with { LineId = Guid.NewGuid(), Name = "Added in review", SourcePage = null }] }));
    }
}
