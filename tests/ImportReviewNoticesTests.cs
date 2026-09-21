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
}
