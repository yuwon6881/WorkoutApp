using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class UnifiedPlateLoadTests
{
    [Theory]
    [InlineData("Plate", LoadModels.External)]
    [InlineData("Barbell", LoadModels.External)]
    [InlineData("Plate-Loaded Machine", LoadModels.External)]
    [InlineData("Bodyweight", LoadModels.FullBodyweight)]
    [InlineData("Machine", LoadModels.FullBodyweight)]
    public async Task Plate_and_weighted_bodyweight_exercises_share_the_plate_default(string equipment, string model)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("lift", "Lift", "Back", equipment, null, LoadModel: model));
        var id = await h.ExerciseId("lift");
        var settings = new LoadSettingsService(h.Db, h.Catalog);
        await settings.SaveEquipment(EquipmentGroups.Barbell, new(5, null, 0), default);

        Assert.Equal(5, (await h.Progression.LoadInfo([id], default))[id].StepKg);
        Assert.Equal(5, (await new ExerciseLoadSettingsService(h.Db).Get(id, default)).DefaultStepKg);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(2.5)]
    public async Task Medicine_ball_defaults_to_one_kilogram_without_changing_personal_rules(double? storedStep)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("throw", "Throw", "Core", "Medicine Ball", null, storedStep));
        var id = await h.ExerciseId("throw");
        var settings = new ExerciseLoadSettingsService(h.Db);
        Assert.Equal(1, (await settings.Get(id, default)).LoadStepKg);
        await settings.Save(id, new(2, null, 0), default);
        Assert.Equal(2, (await settings.Get(id, default)).LoadStepKg);
        var reset = await settings.Save(id, new(null, null, 1), default);
        Assert.Equal(1, reset.LoadStepKg);
    }

    [Theory]
    [InlineData("plate")]
    [InlineData("added-load")]
    public async Task Retired_equipment_groups_cannot_be_saved(string group)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var settings = new LoadSettingsService(h.Db, h.Catalog);
        var failure = await Assert.ThrowsAsync<DomainException>(() => settings.SaveEquipment(group, new(5, null, 0), default));
        Assert.Equal(404, failure.Status);
        Assert.DoesNotContain((await settings.Get(default)).Equipment, x => x.Group == group);
    }
}
