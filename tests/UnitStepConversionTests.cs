using Workout.Api.Domain;
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

    [Theory]
    [InlineData(1.5, null, 2.5)]
    [InlineData(3.0, "Medicine ball", 5.0)]
    [InlineData(4.0, "Machine", 10.0)]
    [InlineData(20.0, "Machine", 45.0)]
    public void ConvertKgToLbStep_picks_the_nearest_pound_step(double stepKg, string? equipment, double expectedLb)
        => Assert.Equal(expectedLb, UnitStepConversion.ConvertKgToLbStep(stepKg, equipment) * UnitStepConversion.PoundsPerKg, 6);

    [Theory]
    [InlineData(3.0, "Machine", 1.25)]
    [InlineData(15.0, "Machine", 7.5)]
    [InlineData(10.0, "kettlebell", 4.0)]
    [InlineData(5.0, "dumbbell", 2.0)]
    public void ConvertLbToKgStep_picks_the_nearest_kilogram_step(double stepLb, string? equipment, double expectedKg)
        => Assert.Equal(expectedKg, UnitStepConversion.ConvertLbToKgStep(stepLb / UnitStepConversion.PoundsPerKg, equipment), 6);

    [Theory]
    [InlineData(1.7, WeightUnits.Kg, WeightUnits.Kg)]
    [InlineData(1.7, WeightUnits.Lb, WeightUnits.Lb)]
    [InlineData(0, WeightUnits.Kg, WeightUnits.Lb)]
    [InlineData(0, WeightUnits.Lb, WeightUnits.Kg)]
    public void InUnit_leaves_a_step_alone_when_nothing_needs_mapping(double stepKg, string from, string to)
        => Assert.Equal(stepKg, UnitStepConversion.InUnit(stepKg, from, to, "Cable"));
}
