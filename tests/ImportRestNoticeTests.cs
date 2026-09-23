using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Min-Max Phase 2 prints "-" for the rest of a superset's first movement, because it goes
/// straight into its partner. That was reported as rest the document left out.
public sealed class ImportRestNoticeTests
{
    private static DraftExercise Exercise(string name, string group, int? rest)
        => new(Guid.NewGuid(), name, null, null, [new DraftSet(4, 6, 9, rest, null, null, null), new DraftSet(4, 6, 9, rest, null, null, null)], group);

    [Fact]
    public void A_superset_lead_resting_into_its_partner_is_not_reported_as_missing_rest()
    {
        var day = new DraftWorkout(Guid.NewGuid(), 6, "Upper", null, null,
            [Exercise("EZ-Bar Cheat Curl", "S1", null), Exercise("EZ-Bar Skull Crusher", "S1", 45)]);

        Assert.DoesNotContain(ImportValidation.ReviewIssues(new ImportDraft("Min-Max Phase 2", [day])), issue => issue.Code == "rest_unspecified");
    }

    [Fact]
    public void The_last_movement_of_a_superset_without_rest_is_still_reported()
    {
        var day = new DraftWorkout(Guid.NewGuid(), 6, "Lower #2", null, null,
            [Exercise("Machine Hip Adduction", "A", null), Exercise("Machine Hip Abduction", "A", null)]);

        var issue = Assert.Single(ImportValidation.ReviewIssues(new ImportDraft("Pure Bodybuilding", [day])), issue => issue.Code == "rest_unspecified");
        Assert.StartsWith("2 sets have", issue.Message);
    }
}
