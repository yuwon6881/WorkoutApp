using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportRepTechniqueReviewTests
{
    private const string TwentyOneRepInstructions =
        "FIRST 7 REPS BOTTOM HALF OF ROM, NEXT 7 REPS TOP HALF OF ROM, LAST 7 REPS FULL ROM";

    [Fact]
    public void Conflicting_single_rep_target_is_flagged_at_the_rep_field_without_rewriting_source_values()
    {
        var draft = Draft(TwentyOneRepInstructions,
            Set("10", 10, 10, warmup: true),
            Set("10", 10, 10),
            Set("10", 10, 10));

        var issue = Assert.Single(ImportValidation.ReviewIssues(draft), issue => issue.Code == "rep_technique_conflict");

        Assert.Equal(57, issue.SourcePage);
        Assert.Equal("repMin", issue.TargetField);
        Assert.Equal(1, issue.SetIndex);
        Assert.Equal(draft.Workouts[0].Exercises[0].LineId, issue.ExerciseLineId);
        Assert.Contains("10", issue.Message);
        Assert.Contains("7+7+7 = 21 reps", issue.Message);
        Assert.Equal(["10", "10", "10"], draft.Workouts[0].Exercises[0].Sets.Select(set => set.RepsText));
    }

    [Fact]
    public void Matching_compound_reps_and_partial_instructions_do_not_require_review()
    {
        var draft = Draft(TwentyOneRepInstructions, Set("7/7/7", 7, 7));

        Assert.DoesNotContain(ImportValidation.ReviewIssues(draft), issue => issue.Code == "rep_technique_conflict");
    }

    [Fact]
    public void Rep_range_that_contains_the_instructed_total_is_not_flagged()
    {
        var draft = Draft(TwentyOneRepInstructions, Set("20-22", 20, 22));

        Assert.DoesNotContain(ImportValidation.ReviewIssues(draft), issue => issue.Code == "rep_technique_conflict");
    }

    [Theory]
    [InlineData("Use partial reps after you reach the printed target, then extend the set to failure.")]
    [InlineData("This discussion references partial reps and full-ROM training as general options.")]
    public void Explanatory_or_extension_only_text_does_not_invent_a_rep_total(string notes)
    {
        var draft = Draft(notes, Set("10", 10, 10));

        Assert.DoesNotContain(ImportValidation.ReviewIssues(draft), issue => issue.Code == "rep_technique_conflict");
    }

    private static ImportDraft Draft(string notes, params DraftSet[] sets)
    {
        var exercise = new DraftExercise(Guid.NewGuid(), "EZ Bar Curl 21s", null, notes, [.. sets], SourcePage: 57);
        var workout = new DraftWorkout(Guid.NewGuid(), 6, "Day 5", null, null, [exercise], SourcePage: 57);
        return new ImportDraft("High Frequency Full Body", [workout]);
    }

    private static DraftSet Set(string repsText, int min, int max, bool warmup = false)
        => new(min, max, 8, 90, null, null, null,
            RepsText: repsText, RestText: "90 sec", Warmup: warmup, SourcePage: 57);
}
