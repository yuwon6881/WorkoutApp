using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class WorkoutDefaultsTests
{
    private static SessionExerciseInput Keep(SessionExerciseView exercise) => new(
        exercise.ExerciseId, exercise.Name, exercise.Note, exercise.Prescription,
        exercise.Sets.Select(set => new SetInput(set.WeightKg, set.Reps, set.Rpe, set.Done,
            set.Warmup, Id: set.Id)).ToList(), Id: exercise.Id, RestSeconds: exercise.RestSeconds);

    [Fact]
    public async Task Notes_and_rest_alone_are_restorable_and_return_to_start_defaults()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await h.Templates.Create(Harness.Template("Push",
            Harness.Exercise(null, "Press", Harness.Set(8, 10)) with { Note = "Original", RestSeconds = 90 }), null, 1, 0, default);
        var start = await h.Workouts.Start(template.Id, null, default);
        var edited = await h.Workouts.Save(start.Id, new SessionInput(null,
            [Keep(start.Exercises[0]) with { Note = "Changed", RestSeconds = 180 }], start.Revision, null), default);
        Assert.True(edited.Exercises[0].CanRestore);
        var restored = await h.Workouts.RestoreExercise(start.Id,
            new SessionExerciseRestoreInput(edited.Exercises[0].Id, edited.Revision), default);
        Assert.Equal("Original", restored.Exercises[0].Note);
        Assert.Equal(90, restored.Exercises[0].RestSeconds);
        Assert.False(restored.Exercises[0].CanRestore);
    }

    [Fact]
    public async Task Removed_exercises_restore_the_start_plan_after_the_template_changes()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await h.Templates.Create(Harness.Template("Push",
            Harness.Exercise(null, "Press", Harness.Set(8, 10)),
            Harness.Exercise(null, "Fly", Harness.Set(12, 15)) with { Note = "Original", RestSeconds = 90 }), null, 1, 0, default);
        var start = await h.Workouts.Start(template.Id, null, default);
        var edited = await h.Workouts.Save(start.Id, new SessionInput(null,
            [Keep(start.Exercises[0])], start.Revision, null), default);
        var plan = await h.Db.TemplateExercises.SingleAsync(row => row.TemplateId == template.Id && row.SourceName == "Fly");
        plan.Note = "New template";
        plan.SetsJson = Json.Write(new List<SetPrescription> { Harness.Set(1, 2) });
        await h.Db.SaveChangesAsync();
        var restored = await h.Workouts.RestoreWorkout(start.Id, new SessionRestoreInput(edited.Revision), default);
        Assert.Equal(new[] { "Press", "Fly" }, restored.Exercises.Select(row => row.Name));
        Assert.Equal("Original", restored.Exercises[1].Note);
        Assert.Equal(12, restored.Exercises[1].Prescription[0].RepMin);
        Assert.Equal(start.Exercises[1].Sets[0].WeightKg, restored.Exercises[1].Sets[0].WeightKg);
    }
}
