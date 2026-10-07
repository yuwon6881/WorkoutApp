using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A load rule keeps the value the lifter typed and the unit they typed it in. Switching the
/// account unit only changes how the rule is read, so switching back always restores it exactly.
public sealed class UnitTaggedLoadRuleTests
{
    private const double PerKg = UnitStepConversion.PoundsPerKg;

    private static async Task SetUnit(Harness h, string unit)
    {
        var user = await h.Db.Users.SingleAsync(x => x.Id == h.Db.CurrentUser);
        user.Unit = unit;
        await h.Db.SaveChangesAsync();
    }

    [Fact]
    public async Task An_equipment_rule_reads_as_a_gym_step_after_a_switch_and_returns_exactly_after_switching_back()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("pushdown", "Pushdown", "Triceps", "Cable", null));
        var service = new LoadSettingsService(h.Db, h.Catalog);
        await service.SaveEquipment(EquipmentGroups.Cable, new(2, null, 0), default);

        await SetUnit(h, WeightUnits.Lb);
        var cable = (await service.Get(default)).Equipment.Single(x => x.Group == EquipmentGroups.Cable);
        Assert.Equal(5, cable.StepKg * PerKg, 6);
        Assert.Equal(5, cable.OwnStepKg!.Value * PerKg, 6);
        Assert.Equal(5, (await h.Catalog.All(default)).Single().LoadStepKg * PerKg, 6);

        await SetUnit(h, WeightUnits.Kg);
        cable = (await service.Get(default)).Equipment.Single(x => x.Group == EquipmentGroups.Cable);
        Assert.Equal(2, cable.StepKg);
        Assert.Equal(2, (await h.Catalog.All(default)).Single().LoadStepKg);

        var row = await h.Db.EquipmentLoadDefaults.AsNoTracking().SingleAsync();
        Assert.Equal((2.0, WeightUnits.Kg, 1), (row.LoadStepKg!.Value, row.LoadStepUnit, row.Revision));
    }

    [Fact]
    public async Task An_exercise_rule_survives_repeated_unit_switches_unchanged()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("chest-press", "Chest Press", "Chest", "Machine", null));
        var id = await h.ExerciseId("chest-press");
        var settings = new ExerciseLoadSettingsService(h.Db);
        await settings.Save(id, new(1.5, null, 0), default);

        for (var i = 0; i < 3; i++)
        {
            await SetUnit(h, WeightUnits.Lb);
            var inLb = await settings.Get(id, default);
            Assert.Equal(2.5, inLb.LoadStepKg * PerKg, 6);
            Assert.Equal(2.5, inLb.OwnStepKg!.Value * PerKg, 6);
            await SetUnit(h, WeightUnits.Kg);
        }

        var inKg = await settings.Get(id, default);
        Assert.Equal((1.5, 1.5), (inKg.LoadStepKg, inKg.OwnStepKg!.Value));
        Assert.Equal(1, inKg.Revision);
    }

    [Fact]
    public async Task A_rule_saved_in_pounds_is_tagged_and_reads_as_a_kilogram_gym_step()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await SetUnit(h, WeightUnits.Lb);
        var service = new LoadSettingsService(h.Db, h.Catalog);
        await service.SaveEquipment(EquipmentGroups.Barbell, new(5 / PerKg, null, 0), default);

        Assert.Equal(WeightUnits.Lb, (await h.Db.EquipmentLoadDefaults.AsNoTracking().SingleAsync()).LoadStepUnit);
        await SetUnit(h, WeightUnits.Kg);
        var barbell = (await service.Get(default)).Equipment.Single(x => x.Group == EquipmentGroups.Barbell);
        Assert.Equal(2.5, barbell.StepKg);
    }

    [Fact]
    public async Task A_read_naming_its_unit_does_not_wait_for_the_account_unit_to_change()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("curl", "Curl", "Biceps", "Dumbbell", null));
        var id = await h.ExerciseId("curl");
        var service = new LoadSettingsService(h.Db, h.Catalog);

        // The account is still kg, as it is while a switch to lb is still being saved.
        var dumbbell = (await service.Get(default, WeightUnits.Lb)).Equipment.Single(x => x.Group == EquipmentGroups.Dumbbell);
        Assert.Equal(5, dumbbell.StepKg * PerKg, 6);
        Assert.Equal(5, (await new ExerciseLoadSettingsService(h.Db).Get(id, default, WeightUnits.Lb)).LoadStepKg * PerKg, 6);
        await Assert.ThrowsAsync<DomainException>(() => service.Get(default, "stone"));
    }

    [Fact]
    public async Task A_save_naming_its_unit_is_tagged_with_that_unit()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("row", "Row", "Back", "Machine", null));
        var id = await h.ExerciseId("row");

        var view = await new ExerciseLoadSettingsService(h.Db).Save(id, new(10 / PerKg, null, 0, WeightUnits.Lb), default);

        Assert.Equal(10, view.LoadStepKg * PerKg, 6);
        Assert.Equal(WeightUnits.Lb, (await h.Db.ExerciseLoadSettings.AsNoTracking().SingleAsync()).LoadStepUnit);
        Assert.Equal(5, (await new ExerciseLoadSettingsService(h.Db).Get(id, default)).LoadStepKg);
    }

    [Fact]
    public async Task A_custom_exercise_default_created_in_pounds_follows_the_account_unit()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await SetUnit(h, WeightUnits.Lb);
        var custom = await new ExerciseService(h.Db).Create(new CustomExerciseInput("Incline Curl", "Biceps", "Dumbbell"), default);
        var stored = await h.Db.CustomExercises.AsNoTracking().SingleAsync(x => x.Id == custom.Id);
        Assert.Equal(WeightUnits.Lb, stored.LoadStepUnit);

        var info = await new ProgressionService(h.Db).LoadInfo([custom.Id], default);
        Assert.Equal(5, info[custom.Id].StepKg * PerKg, 6);

        await SetUnit(h, WeightUnits.Kg);
        info = await new ProgressionService(h.Db).LoadInfo([custom.Id], default);
        Assert.Equal(2, info[custom.Id].StepKg);
        Assert.Equal(2, (await new ExerciseLoadSettingsService(h.Db).Get(custom.Id, default)).DefaultStepKg);
    }

    [Fact]
    public async Task Progression_uses_the_mapped_step_of_a_kilogram_rule_in_pounds()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("squat", "Squat", "Legs", "Barbell", null));
        var id = await h.ExerciseId("squat");
        await new ExerciseLoadSettingsService(h.Db).Save(id, new(2.5, null, 0), default);

        await SetUnit(h, WeightUnits.Lb);
        var info = await new ProgressionService(h.Db).LoadInfo([id], default);
        Assert.Equal(5, info[id].StepKg * PerKg, 6);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(50.5)]
    [InlineData(double.NaN)]
    public async Task A_custom_exercise_rejects_an_out_of_range_typed_step(double step)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await Assert.ThrowsAsync<DomainException>(() => new ExerciseService(h.Db)
            .Create(new CustomExerciseInput("Odd Press", "Chest", "Machine", step), default));
        Assert.False(await h.Db.CustomExercises.AnyAsync());
    }

    [Fact]
    public void The_catalog_version_changes_with_the_account_unit()
    {
        var generation = new Workout.Api.Data.ResourceGeneration { CustomExercises = 3, ExerciseLoads = 4, Templates = 2 };
        var kg = ResourceVersions.For(generation, WeightUnits.Kg);
        var lb = ResourceVersions.For(generation, WeightUnits.Lb);
        Assert.NotEqual(kg.Catalog, lb.Catalog);
        Assert.NotEqual(kg.Templates, lb.Templates);
        Assert.Equal(kg.Programs, lb.Programs);
    }
}
