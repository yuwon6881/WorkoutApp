using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportPauseTests
{
    [Theory]
    [InlineData("Barbell Bench Press", "Pause for two seconds at the chest", true)]
    [InlineData("CLOSE GRIP BENCH PRESS", "SHOULDER WIDTH GRIP, TOUCH BAR TO CHEST WITH SLIGHT PAUSE", true)]
    [InlineData("Paused Squat", null, true)]
    [InlineData("Bench Press", "Pause between sets", false)]
    [InlineData("Bench Press", "Do not pause between sets", false)]
    [InlineData("Bench Press", "Pause for 30 seconds between sets", false)]
    public void Identifies_pause_in_the_movement_or_coaching(string name, string? description, bool expected)
        => Assert.Equal(expected, ImportPause.Requested(name, description));

    [Fact]
    public async Task Prefers_the_matching_pause_variant_and_marks_only_unmatched_movements()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell Bench Press", "Chest", "Barbell", null, 2.5),
            new SeedExercise("pause-bench", "Pause Barbell Bench Press", "Chest", "Barbell", null, 2.5),
            new SeedExercise("curl", "Barbell Curl", "Biceps", "Barbell", null, 2.5));
        var pauseId = await h.ExerciseId("pause-bench");
        var benchId = await h.ExerciseId("bench");
        var set = new AiSet(8, 8, null, null, null, null, null);
        var program = new AiProgram("Test", [new AiDay(null, null, 1, 1, "Day 1", false, null,
            [new AiExercise("Barbell Bench Press", benchId.ToString(), "Pause at the chest", [set]),
             new AiExercise("Barbell Curl", null, "Pause at the top", [set])])]);

        var draft = await h.Imports(StubHandler.Program("{}")).ToDraft(program, default);
        var exercises = draft.Workouts.Single().Exercises;
        Assert.Equal(pauseId, exercises[0].ExerciseId);
        Assert.Null(SetTechniques.Of(exercises[0].Sets.Single().Notes));
        Assert.Equal(SetTechniques.Pause, SetTechniques.Of(exercises[1].Sets.Single().Notes));
    }

    [Fact]
    public void Pause_type_is_separate_from_straight_set_strength_evidence()
    {
        var set = new SetPrescription(8, 8, null, null, null, null, "Pause set");
        Assert.Equal(SetTechniques.Pause, SetTechniques.Of(set));
        Assert.False(SetTechniques.IsStrengthEvidence([SetTechniques.Of(set)], 0));
    }

    [Fact]
    public void Last_set_pause_does_not_mark_the_other_sets()
    {
        var set = new DraftSet(8, 8, null, null, null, null, null);
        var marked = ImportPause.MarkWorkingSets([set with { Warmup = true }, set, set], "Pause at the top on the last set.");
        Assert.Null(marked[0].Notes);
        Assert.Null(marked[1].Notes);
        Assert.Equal("Pause set", marked[2].Notes);
    }
}
