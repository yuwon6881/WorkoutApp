using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class UnitStepConversionTests
{
    [Theory]
    [InlineData(2.5, null, 5.0)]
    [InlineData(2.5, "Plate-loaded", 5.0)]
    [InlineData(2.0, "Dumbbell", 5.0)]
    [InlineData(1.0, "Medicine ball", 2.0)]
    [InlineData(0.5, "Cable", 1.0)]
    [InlineData(1.25, "Barbell", 2.5)]
    [InlineData(5.0, "Plate-loaded", 10.0)]
    public void ConvertKgToLbStep_produces_sensible_gym_increments(double stepKg, string? equipment, double expectedLb)
    {
        var resultKg = UnitStepConversion.ConvertKgToLbStep(stepKg, equipment);
        var resultLb = resultKg * UnitStepConversion.PoundsPerKg;
        Assert.Equal(expectedLb, resultLb, 2);
    }

    [Theory]
    [InlineData(5.0, null, 2.5)]
    [InlineData(5.0, "Plate-loaded", 2.5)]
    [InlineData(5.0, "Dumbbell", 2.0)]
    [InlineData(2.0, "Medicine ball", 1.0)]
    [InlineData(5.0, "Kettlebell", 4.0)]
    [InlineData(2.5, "Barbell", 1.25)]
    [InlineData(10.0, "Plate-loaded", 5.0)]
    public void ConvertLbToKgStep_produces_sensible_gym_increments(double stepLb, string? equipment, double expectedKg)
    {
        var stepKg = stepLb / UnitStepConversion.PoundsPerKg;
        var resultKg = UnitStepConversion.ConvertLbToKgStep(stepKg, equipment);
        Assert.Equal(expectedKg, resultKg, 2);
    }

    [Fact]
    public void EquipmentGroups_AppDefaultStep_is_unit_aware()
    {
        // In kg
        Assert.Equal(2.5, EquipmentGroups.AppDefaultStep(EquipmentGroups.Barbell, "kg"));
        Assert.Equal(2.0, EquipmentGroups.AppDefaultStep(EquipmentGroups.Dumbbell, "kg"));
        Assert.Equal(2.5, EquipmentGroups.AppDefaultStep(EquipmentGroups.Cable, "kg"));
        Assert.Equal(4.0, EquipmentGroups.AppDefaultStep(EquipmentGroups.Kettlebell, "kg"));
        Assert.Equal(1.0, EquipmentGroups.AppDefaultStep(EquipmentGroups.MedicineBall, "kg"));

        // In lb (returned in canonical kg, which converts to sensible lb)
        Assert.Equal(5.0, EquipmentGroups.AppDefaultStep(EquipmentGroups.Barbell, "lb") * UnitStepConversion.PoundsPerKg, 2);
        Assert.Equal(5.0, EquipmentGroups.AppDefaultStep(EquipmentGroups.Dumbbell, "lb") * UnitStepConversion.PoundsPerKg, 2);
        Assert.Equal(5.0, EquipmentGroups.AppDefaultStep(EquipmentGroups.Cable, "lb") * UnitStepConversion.PoundsPerKg, 2);
        Assert.Equal(5.0, EquipmentGroups.AppDefaultStep(EquipmentGroups.Kettlebell, "lb") * UnitStepConversion.PoundsPerKg, 2);
        Assert.Equal(2.0, EquipmentGroups.AppDefaultStep(EquipmentGroups.MedicineBall, "lb") * UnitStepConversion.PoundsPerKg, 2);
    }

    [Fact]
    public void Progression_suggests_exact_5lb_step_when_unit_is_lb()
    {
        var stepLb = 5.0;
        var stepKg = stepLb / UnitStepConversion.PoundsPerKg;
        var startLoadLb = 135.0;
        var startLoadKg = startLoadLb / UnitStepConversion.PoundsPerKg;

        var history = new[]
        {
            new SetExposure(Guid.NewGuid(), DateTime.UtcNow, startLoadKg, 12, 8)
        };

        var suggestion = Progression.SuggestSet(8, 12, 8, history, ProgressionModes.Normal, stepKg);
        Assert.NotNull(suggestion.SuggestedLoadKg);
        var suggestedLb = suggestion.SuggestedLoadKg.Value * UnitStepConversion.PoundsPerKg;

        // Must step from 135 lb to exactly 140 lb, not 139.41 lb or 140.51 lb
        Assert.Equal(140.0, suggestedLb, 2);
    }

    [Fact]
    public async Task ConvertCustomSteps_migrates_equipment_defaults_and_exercises()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();

        // 1. Set equipment default in kg (2.5 kg)
        var loadSettings = new LoadSettingsService(h.Db, h.Catalog);
        await loadSettings.SaveEquipment(EquipmentGroups.Barbell, new LoadRuleInput(2.5, null, 0), default);

        // 2. Create custom exercise with default step (2.5 kg)
        var exerciseService = new ExerciseService(h.Db);
        var custom = await exerciseService.Create(new CustomExerciseInput("Heavy Squat", "Legs", "Barbell", "Squat deep", 2.5), default);

        // 3. Set custom exercise load setting (2.5 kg)
        var exerciseLoadSettings = new ExerciseLoadSettingsService(h.Db);
        await exerciseLoadSettings.Save(custom.Id, new ExerciseLoadSettingsInput(2.5, null, 0), default);

        // Convert kg -> lb
        await UnitStepConversion.ConvertCustomSteps(h.Db, user.Id, "kg", "lb", default);
        await h.Db.SaveChangesAsync(default);

        // Verify equipment default converted to 5 lb
        var updatedEq = await h.Db.EquipmentLoadDefaults.SingleAsync(x => x.Equipment == EquipmentGroups.Barbell);
        Assert.NotNull(updatedEq.LoadStepKg);
        Assert.Equal(5.0, updatedEq.LoadStepKg.Value * UnitStepConversion.PoundsPerKg, 2);

        // Verify custom exercise step converted to 5 lb
        var updatedCustom = await h.Db.CustomExercises.SingleAsync(x => x.Id == custom.Id);
        Assert.Equal(5.0, updatedCustom.LoadStepKg * UnitStepConversion.PoundsPerKg, 2);

        // Verify exercise load setting converted to 5 lb
        var updatedExSetting = await h.Db.ExerciseLoadSettings.SingleAsync(x => x.Id == custom.Id);
        Assert.NotNull(updatedExSetting.LoadStepKg);
        Assert.Equal(5.0, updatedExSetting.LoadStepKg.Value * UnitStepConversion.PoundsPerKg, 2);

        // Convert back lb -> kg
        await UnitStepConversion.ConvertCustomSteps(h.Db, user.Id, "lb", "kg", default);
        await h.Db.SaveChangesAsync(default);

        // Verify equipment default converted back to 2.5 kg
        updatedEq = await h.Db.EquipmentLoadDefaults.SingleAsync(x => x.Equipment == EquipmentGroups.Barbell);
        Assert.Equal(2.5, updatedEq.LoadStepKg!.Value, 2);

        // Verify custom exercise step converted back to 2.5 kg
        updatedCustom = await h.Db.CustomExercises.SingleAsync(x => x.Id == custom.Id);
        Assert.Equal(2.5, updatedCustom.LoadStepKg, 2);

        // Verify exercise load setting converted back to 2.5 kg
        updatedExSetting = await h.Db.ExerciseLoadSettings.SingleAsync(x => x.Id == custom.Id);
        Assert.Equal(2.5, updatedExSetting.LoadStepKg!.Value, 2);
    }
}
