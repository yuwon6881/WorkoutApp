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
    [InlineData("Bench Press", "Rest-pause on the last set", false)]
    [InlineData("Preacher Curl", "Optionally pause for 0.5-1 second in the stretched aspect of each rep", false)]
    [InlineData("Preacher Curl", "Pause 1 second at the bottom of each rep. Do not pause between sets", true)]
    public void Identifies_pause_in_the_movement_or_coaching(string name, string? description, bool expected)
        => Assert.Equal(expected, ImportPause.Requested(name, description));

    [Theory]
    [InlineData("Bench Press with Pause", "Bench Press")]
    [InlineData("Paused Barbell Bench Press", "Barbell Bench Press")]
    public void Base_name_removes_the_pause_qualifier(string name, string expected)
        => Assert.Equal(expected, ImportPause.BaseName(name));

    [Fact]
    public async Task Prefers_the_matching_pause_variant_and_marks_only_unmatched_movements()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell Bench Press", "Chest", "Barbell", null, 2.5),
            new SeedExercise("pause-bench", "Pause Barbell Bench Press", "Chest", "Barbell", null, 2.5),
            new SeedExercise("curl", "Barbell Curl", "Biceps", "Barbell", null, 2.5));
        var pauseId = await h.ExerciseId("pause-bench");
        var draft = (await ExternalDraftFixture.Create(h.Imports(), ExternalDraftFixture.Weeks(1, "Test", """
            {"sourceName":"Barbell Bench Press","notes":"Pause at the chest","sets":[{"repMin":8,"repMax":8}]},
            {"sourceName":"Barbell Curl","notes":"Pause at the top","sets":[{"repMin":8,"repMax":8}]}
            """))).Draft!;
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

    [Fact]
    public async Task Last_set_pause_keeps_base_movement_even_when_a_variant_exists()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell Bench Press", "Chest", "Barbell", null, 2.5),
            new SeedExercise("pause-bench", "Pause Barbell Bench Press", "Chest", "Barbell", null, 2.5));
        var id = await h.ExerciseId("bench");
        var exercise = (await ExternalDraftFixture.Create(h.Imports(), ExternalDraftFixture.Weeks(1, "Test", """
            {"sourceName":"Barbell Bench Press","notes":"Pause 1.5 s on the last set.","sets":[{"repMin":8,"repMax":8},{"repMin":8,"repMax":8}]}
            """))).Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal(id, exercise.ExerciseId);
        Assert.Null(exercise.Sets[0].Notes);
        Assert.Equal("Pause set", exercise.Sets[1].Notes);
    }
}
