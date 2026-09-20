using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportLoadNoticeTests
{
    [Theory]
    [InlineData("75%")]
    [InlineData("85-87.5% 1RM")]
    [InlineData("72.5% 1 RM")]
    public void A_percentage_load_without_rpe_is_informational_and_does_not_create_an_rpe_warning(string load)
    {
        var draft = Draft(load, targetRpe: null);

        var issues = ImportValidation.ReviewIssues(draft);

        var notice = Assert.Single(issues, issue => issue.Code == "percentage_load_without_rpe");
        Assert.Equal("info", notice.Severity);
        Assert.DoesNotContain(issues, issue => issue.Code == "rpe_unspecified");
        Assert.Equal("targetRpe", notice.TargetField);
    }

    [Fact]
    public void A_non_percentage_load_does_not_silence_a_missing_rpe_warning()
    {
        var issues = ImportValidation.ReviewIssues(Draft("100 kg", targetRpe: null));

        Assert.Contains(issues, issue => issue.Code == "rpe_unspecified" && issue.Severity == "warning");
        Assert.DoesNotContain(issues, issue => issue.Code == "percentage_load_without_rpe");
    }

    private static ImportDraft Draft(string load, double? targetRpe)
        => new("Program",
        [new DraftWorkout(Guid.NewGuid(), 1, "Day 1", null, null,
        [new DraftExercise(Guid.NewGuid(), "Back Squat", null, null,
        [new DraftSet(5, 5, targetRpe, 180, null, load, null, SourcePage: 2)], SourcePage: 2)], SourcePage: 2)]);
}
