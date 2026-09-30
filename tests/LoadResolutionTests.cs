using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

public sealed class LoadResolutionTests
{
    private static readonly Guid GymCable = Guid.NewGuid();
    private static readonly Dictionary<Guid, LoadStackRule> Stacks = new()
    {
        [GymCable] = new LoadStackRule(GymCable, "Gym A cable", null, [2.5, 5, 7.5, 10, 15, 20])
    };

    [Fact]
    public void The_exercise_rule_beats_the_equipment_rule_which_beats_the_app_default()
    {
        var equipment = new LoadRule(5, null, null);
        var exercise = new LoadRule(8.75, null, null);

        var app = LoadResolution.Resolve(2.5, EquipmentGroups.Cable, null, null, Stacks);
        Assert.Equal((2.5, LoadSources.App), (app.StepKg, app.Source));

        var shared = LoadResolution.Resolve(2.5, EquipmentGroups.Cable, null, equipment, Stacks);
        Assert.Equal((5.0, LoadSources.Equipment), (shared.StepKg, shared.Source));

        var own = LoadResolution.Resolve(2.5, EquipmentGroups.Cable, exercise, equipment, Stacks);
        Assert.Equal((8.75, LoadSources.Exercise), (own.StepKg, own.Source));
    }

    [Fact]
    public void A_stack_supplies_its_weights_and_names_itself()
    {
        var resolved = LoadResolution.Resolve(2.5, EquipmentGroups.Cable, null, new LoadRule(null, null, GymCable), Stacks);

        Assert.Equal(0, resolved.StepKg);
        Assert.Equal([2.5, 5, 7.5, 10, 15, 20], resolved.AvailableLoadsKg!);
        Assert.Equal("Gym A cable", resolved.StackName);
        Assert.Equal(LoadSources.Equipment, resolved.Source);
    }

    [Fact]
    public void A_missing_stack_falls_through_instead_of_becoming_zero()
    {
        var resolved = LoadResolution.Resolve(2.5, EquipmentGroups.Cable,
            new LoadRule(null, null, Guid.NewGuid()), new LoadRule(5, null, null), Stacks);

        Assert.Equal((5.0, LoadSources.Equipment), (resolved.StepKg, resolved.Source));
    }

    [Fact]
    public void An_empty_exercise_rule_inherits()
    {
        var resolved = LoadResolution.Resolve(2.5, EquipmentGroups.Cable, LoadRule.Empty, new LoadRule(null, [5, 10, 15], null), Stacks);

        Assert.Equal([5, 10, 15], resolved.AvailableLoadsKg!);
        Assert.Equal(LoadSources.Equipment, resolved.Source);
    }

    [Fact]
    public void An_exercise_without_a_group_ignores_equipment_rules()
    {
        var resolved = LoadResolution.Resolve(0, null, null, new LoadRule(5, null, null), Stacks);

        Assert.Equal((0.0, LoadSources.App), (resolved.StepKg, resolved.Source));
    }

    [Theory]
    [InlineData("Cable", LoadModels.External, EquipmentGroups.Cable)]
    [InlineData(" barbell ", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("EZ-Bar", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("Trap Bar", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("Smith Machine", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("Plate-Loaded Machine", LoadModels.External, EquipmentGroups.Barbell)]
    [InlineData("Machine", LoadModels.External, null)]
    [InlineData("Weight-Stack Machine", LoadModels.External, null)]
    [InlineData("Bodyweight", LoadModels.FullBodyweight, EquipmentGroups.AddedLoad)]
    [InlineData("Bodyweight", LoadModels.BodyweightContextOnly, null)]
    [InlineData("Band", LoadModels.External, null)]
    [InlineData("Sandbag", LoadModels.External, null)]
    public void Groups_come_from_equipment_and_load_model(string equipment, string loadModel, string? group)
        => Assert.Equal(group, EquipmentGroups.For(equipment, loadModel));

    [Fact]
    public void Group_app_defaults_match_the_seeded_steps()
    {
        Assert.Equal(2, EquipmentGroups.AppDefaultStep(EquipmentGroups.Dumbbell));
        Assert.Equal(1.25, EquipmentGroups.AppDefaultStep(EquipmentGroups.Plate));
        Assert.Equal(2.5, EquipmentGroups.AppDefaultStep(EquipmentGroups.Cable));
        Assert.Equal(2.5, EquipmentGroups.AppDefaultStep(EquipmentGroups.AddedLoad));
    }
}
