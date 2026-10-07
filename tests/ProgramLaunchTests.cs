using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ProgramLaunchTests
{
    [Fact]
    public async Task Thin_launch_agrees_with_full_program_and_omits_schedule_details()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null));
        var exerciseId = await h.ExerciseId("bench");
        var created = await h.Programs.Create(new ProgramInput("Program", [
            new ProgramWorkoutInput(1, "First", "Push", null, [Harness.Exercise(exerciseId, "Bench", Harness.Set(8, 10))]),
            new ProgramWorkoutInput(2, "Second", "Push", null, [Harness.Exercise(exerciseId, "Bench", Harness.Set(6, 8))])
        ]), true, null, default);
        var (summary, next) = await h.Programs.Launch(default);
        var full = await h.Programs.Get(created.Id, default);
        Assert.NotNull(summary);
        Assert.NotNull(next);
        Assert.Equal(full.NextTemplateId, summary.NextTemplateId);
        Assert.Equal(full.NextTemplateId, next.Id);
        Assert.Equal(full.Workouts.Single(day => day.Id == next.Id).Exercises.Count, next.ExerciseCount);
        Assert.DoesNotContain("workouts", System.Text.Json.JsonSerializer.Serialize(summary).ToLowerInvariant());
    }
}
