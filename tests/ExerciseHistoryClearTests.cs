using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// An open workout reads an exercise's history for the targets and records it froze at start, its
/// "Last time" figures and the progress rebuilt at finish, so that history may not be cleared under it.
public sealed class ExerciseHistoryClearTests
{
    private static async Task FinishWorkout(Harness h, Guid exerciseId, string name)
    {
        var template = await h.Templates.Create(Harness.Template(name, Harness.Exercise(exerciseId, "Lift", Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var exercise = session.Exercises[0];
        var saved = await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exerciseId, "Lift", null, exercise.Prescription,
                [new SetInput(60, 8, 8, true, Id: exercise.Sets[0].Id)], Id: exercise.Id)], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, saved.Revision, default);
    }

    [Fact]
    public async Task An_open_workout_that_includes_the_exercise_is_named_and_blocks_clearing()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null));
        var bench = await h.ExerciseId("bench");
        await FinishWorkout(h, bench, "Push A");
        var open = await h.Templates.Create(Harness.Template("Push B", Harness.Exercise(bench, "Bench", Harness.Set(8, 10))), null, 1, 1, default);
        await h.Workouts.Start(open.Id, null, default);
        var exercises = new ExerciseService(h.Db);

        var preview = await exercises.ClearPreview(bench, default);
        Assert.True(preview.HasActiveWorkout);
        Assert.False(preview.CanClear);
        Assert.Equal("Push B", preview.ActiveWorkoutName);

        var refused = await Assert.ThrowsAsync<DomainException>(() => exercises.ClearHistory(bench, default));
        Assert.Equal(409, refused.Status);
        Assert.Contains("Push B", refused.Message);
        // Nothing was removed: the finished workout still holds its set.
        Assert.Equal(1, (await exercises.ClearPreview(bench, default)).AffectedSets);
    }

    [Fact]
    public async Task An_open_workout_without_the_exercise_does_not_block_clearing()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null), new SeedExercise("row", "Row", "Back", "Barbell", null));
        var bench = await h.ExerciseId("bench");
        var row = await h.ExerciseId("row");
        await FinishWorkout(h, bench, "Push A");
        var pull = await h.Templates.Create(Harness.Template("Pull", Harness.Exercise(row, "Row", Harness.Set(8, 10))), null, 1, 1, default);
        await h.Workouts.Start(pull.Id, null, default);
        var exercises = new ExerciseService(h.Db);

        var preview = await exercises.ClearPreview(bench, default);
        Assert.False(preview.HasActiveWorkout);
        Assert.True(preview.CanClear);
        Assert.Null(preview.ActiveWorkoutName);

        var cleared = await exercises.ClearHistory(bench, default);
        Assert.Equal(1, cleared.AffectedSets);
    }
}
