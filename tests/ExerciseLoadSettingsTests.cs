using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ExerciseLoadSettingsTests
{
    [Fact]
    public async Task Settings_are_personal_revision_checked_and_resettable()
    {
        await using var h = await Harness.Create();
        var alice = await h.SignIn();
        await h.Seed(new SeedExercise("curl", "Curl", "Biceps", "Cable", "", null, 2.5));
        var id = await h.ExerciseId("curl");
        var service = new ExerciseLoadSettingsService(h.Db);
        var saved = await service.Save(id, new(1, null, 0), default);
        Assert.Equal(1, saved.LoadStepKg);
        Assert.Equal(1, (await h.Progression.LoadInfo([id], default))[id].StepKg);
        await Assert.ThrowsAsync<DomainException>(() => service.Save(id, new(5, null, 0), default));
        await h.SignIn("bob");
        Assert.Equal(2.5, (await service.Get(id, default)).LoadStepKg);
        Assert.Equal(2.5, (await h.Catalog.All(default)).Single().LoadStepKg);
        h.Db.CurrentUser = alice.Id;
        var reset = await service.Save(id, new(null, null, saved.Revision), default);
        Assert.Equal(2.5, reset.LoadStepKg);
        Assert.False(reset.IsCustomized);
        Assert.Equal(2, reset.Revision);
    }

    [Fact]
    public async Task Uneven_weights_drive_the_next_workout_without_rewriting_history()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("curl", "Curl", "Biceps", "Dumbbell", "", null, 2));
        var id = await h.ExerciseId("curl");
        var template = await h.Templates.Create(Harness.Template("Arms",
            Harness.Exercise(id, "Curl", Harness.Set(10, 15))), null, 1, 0, default);
        var first = await h.Workouts.Start(template.Id, null, default);
        var exercise = first.Exercises.Single();
        await h.Workouts.Save(first.Id, new SessionInput(null,
            [new SessionExerciseInput(id, "Curl", null, exercise.Prescription,
                [new SetInput(20, 15, 8, true, Id: exercise.Sets[0].Id)], Id: exercise.Id)],
            first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);
        await new ExerciseLoadSettingsService(h.Db).Save(id, new(null, [10, 15, 20, 22, 26], 0), default);
        var next = await h.Workouts.Start(template.Id, null, default);
        Assert.Equal(22, next.Exercises.Single().Sets[0].WeightKg);
        Assert.False(next.Exercises.Single().Sets[0].Done);
    }

    [Fact]
    public void Uneven_load_navigation_handles_gaps_and_boundaries()
    {
        var loads = new LoadOptions(0, AvailableLoadsKg: [5, 7.5, 12, 20]);
        Assert.True(loads.Adjustable);
        Assert.Equal(12, loads.Next(8));
        Assert.Equal(7.5, loads.Previous(12));
        Assert.Equal(12, loads.AtMost(19));
        Assert.Equal(5, loads.AtMost(1));
        Assert.Equal(20, loads.Next(20));
        Assert.Equal(5, loads.Previous(5));
    }

    [Fact]
    public async Task Invalid_inputs_and_other_accounts_custom_exercises_are_rejected()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var custom = await new ExerciseService(h.Db).Create(new("My cable curl", "Biceps", "Cable", ""), default);
        var service = new ExerciseLoadSettingsService(h.Db);
        foreach (var input in new ExerciseLoadSettingsInput[] {
            new(-1, null, 0), new(51, null, 0), new(double.NaN, null, 0),
            new(2, [5, 10], 0), new(null, [5], 0), new(null, [5, 5], 0), new(null, [5, 1001], 0) })
            await Assert.ThrowsAsync<DomainException>(() => service.Save(custom.Id, input, default));
        var saved = await service.Save(custom.Id, new(null, [20, 5, 12, 5], 0), default);
        Assert.Equal(new double[] { 5, 12, 20 }, saved.AvailableLoadsKg);
        Assert.Equal(new double[] { 5, 12, 20 }, (await h.Catalog.All(default)).Single().AvailableLoadsKg);
        await h.SignIn("bob");
        await Assert.ThrowsAsync<DomainException>(() => service.Get(custom.Id, default));
        await Assert.ThrowsAsync<DomainException>(() => service.Save(custom.Id, new(1, null, 0), default));
    }

    [Fact]
    public void Pound_steps_do_not_repeat_the_same_weight_after_logging_rounds_to_grams()
    {
        var step = 20 / 2.2046226218;
        var rounded = Math.Round(step * 2, 3);
        Assert.Equal(step * 3, new LoadOptions(step).Next(rounded), 6);
        Assert.Equal(step * 3, new LoadOptions(0, AvailableLoadsKg: [step, step * 2, step * 3]).Next(rounded), 6);
    }

    [Theory]
    [InlineData(ResistanceModes.Added, 93)]
    [InlineData(ResistanceModes.Assistance, 67)]
    public async Task Bodyweight_logging_preserves_available_weights_instead_of_rounding_to_the_default(string mode, double systemLoad)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("pull", "Pull-up", "Back", "Machine", "", null, 2.5, LoadModels.FullBodyweight));
        var id = await h.ExerciseId("pull");
        var template = await h.Templates.Create(Harness.Template("Pull", Harness.Exercise(id, "Pull-up", Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var row = await h.Db.Workouts.SingleAsync(x => x.Id == session.Id);
        row.BodyWeightSnapshotJson = Json.Write(new BodyWeightSnapshot(80, null, null, null, 80, "scale", null, "test", null, DateTime.UtcNow));
        await h.Db.SaveChangesAsync();
        await new ExerciseLoadSettingsService(h.Db).Save(id, new(null, [7, 13, 21], 0), default);
        var exercise = session.Exercises.Single();
        var saved = await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(id, exercise.Name, null, exercise.Prescription,
                [new SetInput(13, 10, 8, true, ResistanceMode: mode, Id: exercise.Sets[0].Id)], Id: exercise.Id)],
            session.Revision, null), default);
        Assert.Equal(13, saved.Exercises.Single().Sets[0].WeightKg);
        Assert.Equal(systemLoad, saved.Exercises.Single().Sets[0].SystemLoadKg);
    }
}
