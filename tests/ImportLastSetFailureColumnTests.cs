using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportLastSetFailureColumnTests
{
    [Theory]
    [InlineData("Y")]
    [InlineData("N")]
    public void Failure_instruction_does_not_narrow_partial_rep_scope(string value)
    {
        var program = new AiProgram("Back", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Barbell Row", null, null, [], SourcePage: 7)
        ], 7)]);
        var source = $"""
            === PAGE 7 ===
            DAY LABEL: DAY 1
            Exercise | Sets | Reps | RPE | Rest | Notes | LSTF
            Barbell Row | 3 | 7+7 | 9 | 2 MIN | Do 7 reps full ROM, 7 reps bottom 1/2 ROM | {value}
            """;
        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, source).Days!).Exercises);
        Assert.All(exercise.Sets, set => Assert.Contains("Partial", set.Notes));
        Assert.Equal([9d, 9d, value == "Y" ? 10d : 9d], exercise.Sets.Select(set => set.TargetRpe));
    }

    [Theory]
    [InlineData("Y", "Use a full range of motion", 10, true)]
    [InlineData("YES", "Use a full range of motion", 10, true)]
    [InlineData("N", "Use a full range of motion", 9, false)]
    [InlineData("", "Use a full range of motion", 9, false)]
    [InlineData("Y", "Avoid failure", 9, true)]
    public void Failure_column_applies_to_only_the_final_set(string value, string note, int lastEffort, bool instruction)
    {
        var program = new AiProgram("Back", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Cable Row", null, null,
                [new AiSet(8, 8, 7, null, null, null, null)], SourcePage: 7)
        ], 7)]);
        var source = $"""
            === PAGE 7 ===
            DAY LABEL: DAY 1
            Exercise | Sets | Reps | RPE | Rest | Notes | LSTF
            Cable Row | 3 | 10-12 | 9 | 1 MIN | {note} | {value}
            """;
        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, source).Days!).Exercises);
        Assert.Equal([9d, 9d, (double)lastEffort], exercise.Sets.Select(set => set.TargetRpe));
        Assert.Equal(instruction, exercise.CoachingNotes!.Contains("LSTF: Y"));
        if (value == "N") Assert.Contains("LSTF: N", exercise.CoachingNotes);
        var draftExercise = new DraftExercise(Guid.NewGuid(), exercise.SourceName, null, exercise.CoachingNotes,
            [new DraftSet(10, 12, lastEffort, 60, null, null, null)], SourcePage: 7);
        var issues = ImportSetInstructionReview.Issues([
            new DraftWorkout(Guid.NewGuid(), 1, "Day 1", null, null, [draftExercise])
        ]);
        Assert.Equal(note == "Avoid failure", issues.Any(issue => issue.Code == "effort_instruction_conflict"));
    }
}
