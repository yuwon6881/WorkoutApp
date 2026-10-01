using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A review item the read could not settle stops blocking once the reviewer edits what it points
/// at, and comes back when that edit is undone or the draft is restored.
public sealed class ImportReviewEditsTests
{
    private const string TwentyOneRepInstructions =
        "FIRST 7 REPS BOTTOM HALF OF ROM, NEXT 7 REPS TOP HALF OF ROM, LAST 7 REPS FULL ROM";

    [Fact]
    public void Editing_a_conflicting_exercise_clears_its_item_and_undoing_the_edit_restores_it()
    {
        var baseline = Draft(Exercise(TwentyOneRepInstructions, Set(10), Set(10)));
        Assert.Contains(Issues(baseline, baseline), issue => issue.Code == "rep_technique_conflict");

        // Any change to that exercise is the reviewer's call, even one that leaves the reps alone.
        var edited = WithExercise(baseline, exercise => exercise with
        {
            Sets = [.. exercise.Sets.Select(set => set with { TargetRpe = 9, RpeSource = "userEdited" })]
        });
        Assert.DoesNotContain(Issues(baseline, edited), issue => issue.Code == "rep_technique_conflict");

        var undone = WithExercise(edited, _ => baseline.Workouts[0].Exercises[0]);
        Assert.Contains(Issues(baseline, undone), issue => issue.Code == "rep_technique_conflict");
    }

    [Fact]
    public void An_unread_rest_moves_on_to_the_next_unedited_exercise()
    {
        var first = Exercise("", Unrested(), Unrested());
        var second = Exercise("", Unrested());
        var baseline = Draft(first, second);

        var before = Assert.Single(Issues(baseline, baseline), issue => issue.Code == "rest_unread");
        Assert.Equal(first.LineId, before.ExerciseLineId);

        // The review edits rest on the exercise, never on each set, so that is what settles it.
        var oneEdited = WithExercise(baseline, exercise => exercise with { RestSeconds = 120 });
        var after = Assert.Single(Issues(baseline, oneEdited), issue => issue.Code == "rest_unread");
        Assert.Equal(second.LineId, after.ExerciseLineId);
        Assert.Contains("1 set has", after.Message);

        var bothEdited = oneEdited with
        {
            Workouts = [oneEdited.Workouts[0] with
            {
                Exercises = [oneEdited.Workouts[0].Exercises[0], second with { RestSeconds = 90 }]
            }]
        };
        Assert.DoesNotContain(Issues(baseline, bothEdited), issue => issue.Code == "rest_unread");
    }

    [Fact]
    public void Reading_notices_clear_on_their_target_but_structural_and_info_items_do_not()
    {
        var baseline = Draft(Exercise("", Set(10)));
        var day = baseline.Workouts[0];
        var exercise = day.Exercises[0];
        var edited = WithExercise(baseline, current => current with { SourceName = "EZ-Bar Curl" });
        var edits = ImportReviewEdits.Compare(baseline, edited);

        Assert.True(edits.Reviewed(new ImportReviewIssue("exercise_sets_trimmed", "Check sets.", "warning", 57,
            day.LineId, exercise.LineId)));
        Assert.True(edits.Reviewed(new ImportReviewIssue("day_label_ambiguous", "Check day.", "warning", 57, day.LineId)));
        Assert.True(edits.Reviewed(new ImportReviewIssue("section_without_text", "Check pages.", "warning", 56,
            SourcePageTo: 58)));
        Assert.False(edits.Reviewed(new ImportReviewIssue("section_without_text", "Other pages.", "warning", 90)));
        Assert.False(edits.Reviewed(new ImportReviewIssue("day_name_from_source", "Noted.", "info", 57, day.LineId)));
        Assert.False(edits.Reviewed(new ImportReviewIssue("chunk_day_count", "A day is missing.", "warning", 57)));
        Assert.False(edits.Reviewed(new ImportReviewIssue("program_week_gap", "Week 3 is empty.", "warning", 57, day.LineId)));

        var untouched = ImportReviewEdits.Compare(baseline, baseline);
        Assert.False(untouched.Reviewed(new ImportReviewIssue("exercise_sets_trimmed", "Check sets.", "warning", 57,
            day.LineId, exercise.LineId)));
    }

    [Fact]
    public void Deleting_a_day_answers_an_item_about_its_pages()
    {
        var baseline = Draft(Exercise("", Set(10)));
        var emptied = baseline with { Workouts = [] };

        Assert.True(ImportReviewEdits.Compare(baseline, emptied)
            .Reviewed(new ImportReviewIssue("printed_schedule_mismatch", "Check the schedule.", "warning", 57)));
    }

    [Fact]
    public void A_missing_or_unreadable_baseline_reviews_nothing()
    {
        var draft = Draft(Exercise(TwentyOneRepInstructions, Set(10)));
        var issue = new ImportReviewIssue("exercise_sets_trimmed", "Check sets.", "warning", 57,
            ExerciseLineId: draft.Workouts[0].Exercises[0].LineId);

        Assert.False(ImportReviewEdits.Compare((string?)null, draft).Reviewed(issue));
        Assert.False(ImportReviewEdits.Compare("{not json", draft).Reviewed(issue));
    }

    private static List<ImportReviewIssue> Issues(ImportDraft baseline, ImportDraft current)
        => ImportValidation.ReviewIssues(current, ImportReviewEdits.Compare(baseline, current));

    private static ImportDraft WithExercise(ImportDraft draft, Func<DraftExercise, DraftExercise> change)
    {
        var day = draft.Workouts[0];
        return draft with { Workouts = [day with { Exercises = [change(day.Exercises[0]), .. day.Exercises.Skip(1)] }] };
    }

    private static ImportDraft Draft(params DraftExercise[] exercises)
        => new("High Frequency Full Body",
            [new DraftWorkout(Guid.NewGuid(), 6, "Day 5 Deltoid Focused Full Body", null, null, [.. exercises], SourcePage: 57)]);

    private static DraftExercise Exercise(string notes, params DraftSet[] sets)
        => new(Guid.NewGuid(), "EZ Bar Curl 21s", null, notes, [.. sets], SourcePage: 57);

    private static DraftSet Set(int reps)
        => new(reps, reps, 7, 90, null, null, null, RepsText: reps.ToString(), RestText: "1-2 MIN", SourcePage: 57);

    private static DraftSet Unrested()
        => new(10, 10, 7, null, null, null, null, RestSource: "inferred", RepsText: "10", SourcePage: 57);
}
