using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Reps and weight are what the lifter logs against a plan; they are never a change to the plan, so
/// finishing a workout where only those moved must not offer to update the program.
public sealed class WorkoutFinishPlanLoggedValuesTests
{
    [Fact]
    public async Task Changing_only_logged_reps_weight_and_effort_offers_no_program_update()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null));
        var id = await h.ExerciseId("bench");
        var program = await h.Programs.Create(new ProgramInput("Program", [
            new ProgramWorkoutInput(1, "First", "Push", null, [Harness.Exercise(id, "Bench", Harness.Set(8, 10) with { Rir = "2" })]),
            new ProgramWorkoutInput(2, "Second", "Push", null, [Harness.Exercise(id, "Bench", Harness.Set(8, 10) with { Rir = "2" })])
        ]), true, null, default);
        var session = await h.Workouts.Start(program.Workouts.Single(d => d.Week == 1).Id, null, default);
        var exercise = session.Exercises[0];

        var saved = await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(id, exercise.Name, exercise.Note, exercise.Prescription,
                [new SetInput(72.5, 13, 9, true, Id: exercise.Sets[0].Id, Rir: "1")], Id: exercise.Id)], session.Revision, null), default);

        var preview = await h.Workouts.PreviewFinishPlan(saved.Id, default);
        Assert.Empty(preview.Edits);
    }
}
