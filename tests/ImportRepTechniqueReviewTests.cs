using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportRepTechniqueReviewTests
{
    [Fact]
    public void Contradictory_failure_instructions_require_review()
    {
        var draft = Draft("AVOID FAILURE. TAKE THE FINAL SET OF EACH EXERCISE TO FAILURE", Set("12", 12, 12));
        var issue = Assert.Single(ImportValidation.ReviewIssues(draft), issue => issue.Code == "effort_instruction_conflict");
        Assert.Equal("targetRpe", issue.TargetField);
        Assert.Equal(57, issue.SourcePage);
    }
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
    [InlineData("7 REPS BOTTOM 1/2 ROM, 7 REPS TOP 1/2 ROM, 7 REPS FULL ROM")]
    [InlineData("7 REPS BOTTOM ½ ROM, 7 REPS TOP ½ ROM, 7 REPS FULL ROM")]
    public void Fractional_rom_segments_are_checked_against_the_printed_rep_target(string notes)
    {
        var draft = Draft(notes, Set("15", 15, 15));

        var issue = Assert.Single(ImportValidation.ReviewIssues(draft), issue => issue.Code == "rep_technique_conflict");

        Assert.Contains("7+7+7 = 21 reps", issue.Message);
        Assert.Equal("15", draft.Workouts[0].Exercises[0].Sets[0].RepsText);
    }

    [Theory]
    [InlineData(2, true)]
    [InlineData(3, false)]
    public void Numbered_working_set_instructions_beyond_the_actual_count_require_review(int count, bool conflict)
    {
        var sets = Enumerable.Repeat(Set("4, 6, 8", 4, 4), count).Prepend(Set("8", 8, 8, warmup: true)).ToArray();
        var draft = Draft("For set 2, drop the weight and do 6 reps. For set 3, drop it again and do 8 reps.", sets);

        var issues = ImportValidation.ReviewIssues(draft).Where(issue => issue.Code == "working_set_instruction_conflict").ToList();

        Assert.Equal(conflict ? 1 : 0, issues.Count);
        if (conflict)
        {
            Assert.Equal("sets", issues[0].TargetField);
            Assert.Equal(57, issues[0].SourcePage);
        }
        Assert.Equal(count + 1, draft.Workouts[0].Exercises[0].Sets.Count);
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
