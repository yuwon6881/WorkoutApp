using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

public sealed class LoadResolutionTests
{
    [Fact]
    public void The_exercise_rule_beats_the_equipment_rule_which_beats_the_app_default()
    {
        var equipment = new LoadRule(5, null);
        var exercise = new LoadRule(8.75, null);

        var app = LoadResolution.Resolve(2.5, EquipmentGroups.Cable, null, null);
        Assert.Equal((2.5, LoadSources.App), (app.StepKg, app.Source));

        var shared = LoadResolution.Resolve(2.5, EquipmentGroups.Cable, null, equipment);
        Assert.Equal((5.0, LoadSources.Equipment), (shared.StepKg, shared.Source));

        var own = LoadResolution.Resolve(2.5, EquipmentGroups.Cable, exercise, equipment);
        Assert.Equal((8.75, LoadSources.Exercise), (own.StepKg, own.Source));
    }

    [Fact]
    public void An_empty_exercise_rule_inherits()
    {
        var resolved = LoadResolution.Resolve(2.5, EquipmentGroups.Cable, LoadRule.Empty, new LoadRule(null, [5, 10, 15]));

        Assert.Equal([5, 10, 15], resolved.AvailableLoadsKg!);
        Assert.Equal(LoadSources.Equipment, resolved.Source);
    }

    [Fact]
    public void An_exercise_without_a_group_ignores_equipment_rules()
    {
        var resolved = LoadResolution.Resolve(0, null, null, new LoadRule(5, null));

        Assert.Equal((0.0, LoadSources.App), (resolved.StepKg, resolved.Source));
    }

    [Theory]
    [InlineData("Plate", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("Cable", LoadModels.External, EquipmentGroups.Cable)]
    [InlineData(" barbell ", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("EZ-Bar", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("Trap Bar", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("Smith Machine", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("Plate-Loaded Machine", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("Machine", LoadModels.External, null)]
    [InlineData("Weight-Stack Machine", LoadModels.External, null)]
    [InlineData("Bodyweight", LoadModels.FullBodyweight, EquipmentGroups.Barbell)]
    [InlineData("Bodyweight", LoadModels.BodyweightContextOnly, null)]
    [InlineData("Band", LoadModels.External, null)]
    [InlineData("Sandbag", LoadModels.External, null)]
    public void Groups_come_from_equipment_and_load_model(string equipment, string loadModel, string? group)
        => Assert.Equal(group, EquipmentGroups.For(equipment, loadModel));

    [Fact]
    public void Group_app_defaults_match_the_seeded_steps()
    {
        Assert.Equal(2, EquipmentGroups.AppDefaultStep(EquipmentGroups.Dumbbell));
        Assert.Equal(2.5, EquipmentGroups.AppDefaultStep(EquipmentGroups.Barbell));
        Assert.Equal(2.5, EquipmentGroups.AppDefaultStep(EquipmentGroups.Cable));
        Assert.Equal(1, EquipmentGroups.AppDefaultStep(EquipmentGroups.MedicineBall));
    }
}
