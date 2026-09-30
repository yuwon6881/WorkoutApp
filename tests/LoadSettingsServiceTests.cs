using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class LoadSettingsServiceTests
{
    private static LoadSettingsService Service(Harness h) => new(h.Db, h.Catalog);

    /// Logs the top of the rep range at a load, finishes, and returns the next session's first load.
    private static async Task<double?> NextLoadAfter(Harness h, Guid id, double loggedKg)
    {
        var template = await h.Templates.Create(Harness.Template("Day",
            Harness.Exercise(id, "Lift", Harness.Set(10, 15))), null, 1, 0, default);
        var first = await h.Workouts.Start(template.Id, null, default);
        var exercise = first.Exercises.Single();
        await h.Workouts.Save(first.Id, new SessionInput(null,
            [new SessionExerciseInput(id, "Lift", null, exercise.Prescription,
                [new SetInput(loggedKg, 15, 8, true, Id: exercise.Sets[0].Id)], Id: exercise.Id)],
            first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);
        var next = await h.Workouts.Start(template.Id, null, default);
        return next.Exercises.Single().Sets[0].WeightKg;
    }

    [Fact]
    public async Task An_equipment_default_moves_every_exercise_of_that_equipment()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("pushdown", "Pushdown", "Triceps", "Cable", "", null));
        var id = await h.ExerciseId("pushdown");

        var view = await Service(h).SaveEquipment(EquipmentGroups.Cable, new(5, null, null, 0), default);

        var cable = view.Equipment.Single(x => x.Group == EquipmentGroups.Cable);
        Assert.Equal((5.0, LoadSources.Equipment, 1), (cable.StepKg, cable.Source, cable.ExerciseCount));
        Assert.Equal(5, (await h.Catalog.All(default)).Single().LoadStepKg);
        Assert.Equal(65, await NextLoadAfter(h, id, 60));
    }

    [Fact]
    public async Task A_stack_snaps_progression_to_its_next_weight()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("shoulder-press", "Shoulder Press", "Shoulders", "Machine", "", null));
        var id = await h.ExerciseId("shoulder-press");
        var service = Service(h);
        var stacks = await service.SaveStack(null, new("Gym B press", null, [35, 38.75, 42.5, 46.25], 0), default);
        var stack = stacks.Stacks.Single();

        await new ExerciseLoadSettingsService(h.Db).Save(id, new(null, null, 0, stack.Id), default);

        var settings = await new ExerciseLoadSettingsService(h.Db).Get(id, default);
        Assert.Equal(("Gym B press", LoadSources.Exercise), (settings.StackName, settings.Source));
        Assert.Equal(42.5, await NextLoadAfter(h, id, 38.75));
        Assert.Equal(1, (await service.Get(default)).Stacks.Single().ExerciseCount);
    }

    [Fact]
    public async Task An_exercise_rule_beats_its_equipment_default()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("row", "Cable Row", "Back", "Cable", "", null));
        var id = await h.ExerciseId("row");
        await Service(h).SaveEquipment(EquipmentGroups.Cable, new(5, null, null, 0), default);

        var own = await new ExerciseLoadSettingsService(h.Db).Save(id, new(1.25, null, 0), default);

        Assert.Equal((1.25, LoadSources.Exercise), (own.LoadStepKg, own.Source));
        Assert.Equal((5.0, LoadSources.Equipment), (own.Inherited!.StepKg, own.Inherited.Source));
        Assert.Equal(61.25, await NextLoadAfter(h, id, 60));
    }

    [Fact]
    public async Task Deleting_a_stack_returns_its_users_to_their_inherited_rule()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("fly", "Cable Fly", "Chest", "Cable", "", null));
        var id = await h.ExerciseId("fly");
        var service = Service(h);
        var stack = (await service.SaveStack(null, new("Old gym", 7.5, null, 0), default)).Stacks.Single();
        await service.SaveEquipment(EquipmentGroups.Cable, new(null, null, stack.Id, 0), default);
        await new ExerciseLoadSettingsService(h.Db).Save(id, new(null, null, 0, stack.Id), default);

        var view = await service.DeleteStack(stack.Id, default);

        Assert.Empty(view.Stacks);
        Assert.Empty(view.Overrides);
        Assert.Equal((2.5, LoadSources.App), (view.Equipment.Single(x => x.Group == EquipmentGroups.Cable).StepKg,
            view.Equipment.Single(x => x.Group == EquipmentGroups.Cable).Source));
        Assert.Equal(2.5, (await h.Catalog.All(default)).Single().LoadStepKg);
    }

    [Fact]
    public async Task Rules_are_validated_revision_checked_and_personal()
    {
        await using var h = await Harness.Create();
        var alice = await h.SignIn();
        await h.Seed(new SeedExercise("curl", "Cable Curl", "Biceps", "Cable", "", null));
        var id = await h.ExerciseId("curl");
        var service = Service(h);

        await Assert.ThrowsAsync<DomainException>(() => service.SaveEquipment("sandbag", new(5, null, null, 0), default));
        await Assert.ThrowsAsync<DomainException>(() => service.SaveEquipment(EquipmentGroups.Cable, new(5, [5, 10], null, 0), default));
        await Assert.ThrowsAsync<DomainException>(() => service.SaveStack(null, new("Empty", null, null, 0), default));
        var stack = (await service.SaveStack(null, new("Mine", null, [5, 10], 0), default)).Stacks.Single();
        await Assert.ThrowsAsync<DomainException>(() => service.SaveStack(null, new("Mine", 2.5, null, 0), default));
        await service.SaveEquipment(EquipmentGroups.Cable, new(5, null, null, 0), default);
        var stale = await Assert.ThrowsAsync<DomainException>(() => service.SaveEquipment(EquipmentGroups.Cable, new(10, null, null, 0), default));
        Assert.Equal(409, stale.Status);

        await h.SignIn("bob");
        var bobs = await service.Get(default);
        Assert.Empty(bobs.Stacks);
        Assert.Equal(LoadSources.App, bobs.Equipment.Single(x => x.Group == EquipmentGroups.Cable).Source);
        var foreign = await Assert.ThrowsAsync<DomainException>(() =>
            new ExerciseLoadSettingsService(h.Db).Save(id, new(null, null, 0, stack.Id), default));
        Assert.Equal(404, foreign.Status);
        h.Db.CurrentUser = alice.Id;
    }

    [Fact]
    public async Task An_exercise_rule_survives_a_catalog_rename()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("shoulder-press", "Shoulder Press", "Shoulders", "Machine", "", null));
        var id = await h.ExerciseId("shoulder-press");
        await new ExerciseLoadSettingsService(h.Db).Save(id, new(8.75, null, 0), default);

        await h.Seed(new SeedExercise("shoulder-press", "Plate-Loaded Shoulder Press", "Shoulders", "Machine", "", null));

        var renamed = (await h.Catalog.All(default)).Single(x => x.Id == id);
        Assert.Equal(("Plate-Loaded Shoulder Press", 8.75), (renamed.Name, renamed.LoadStepKg));
    }

    [Fact]
    public async Task A_typed_custom_increment_becomes_that_exercises_own_rule()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var exercises = new ExerciseService(h.Db);
        var typed = await exercises.Create(new CustomExerciseInput("Gym Row", "Back", "Cable", null, LoadStepKg: 4), default);
        var plain = await exercises.Create(new CustomExerciseInput("Gym Fly", "Chest", "Cable", null), default);
        await Service(h).SaveEquipment(EquipmentGroups.Cable, new(5, null, null, 0), default);

        var catalog = (await h.Catalog.All(default)).ToDictionary(x => x.Id);
        Assert.Equal((4.0, LoadSources.Exercise), (catalog[typed.Id].LoadStepKg, catalog[typed.Id].LoadSource));
        Assert.Equal((5.0, LoadSources.Equipment), (catalog[plain.Id].LoadStepKg, catalog[plain.Id].LoadSource));
        Assert.Equal(2.5, typed.LoadStepKg);
        Assert.Equal(1, await h.Db.ExerciseLoadSettings.CountAsync());
    }
}
