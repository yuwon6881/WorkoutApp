namespace Workout.Api.Domain;

/// One stored load rule: a fixed step or the weights that exist. Neither means inherit.
/// Unit is the one the step was typed in; available weights are physical and never mapped.
public sealed record LoadRule(double? StepKg, IReadOnlyList<double>? LoadsKg, string Unit = WeightUnits.Kg)
{
    public static readonly LoadRule Empty = new(null, null);

    /// The rule as read by an account using unit: its step becomes that unit's nearest gym step.
    public LoadRule In(string unit, string? equipment) => StepKg is { } step && Unit != unit
        ? this with { StepKg = UnitStepConversion.InUnit(step, Unit, unit, equipment), Unit = unit }
        : this;
}

public static class LoadSources
{
    public const string Exercise = "exercise";
    public const string Equipment = "equipment";
    public const string App = "app";
}

public sealed record ResolvedLoad(double StepKg, IReadOnlyList<double>? AvailableLoadsKg, string Source,
    string? EquipmentGroup);

public static class LoadResolution
{
    /// The exercise's own rule wins, then its account equipment rule, then its app default.
    public static ResolvedLoad Resolve(double appStepKg, string? equipmentGroup, LoadRule? exercise, LoadRule? equipment)
    {
        if (Apply(exercise, LoadSources.Exercise, equipmentGroup) is { } own) return own;
        if (equipmentGroup is not null && Apply(equipment, LoadSources.Equipment, equipmentGroup) is { } shared) return shared;
        return new ResolvedLoad(appStepKg, null, LoadSources.App, equipmentGroup);
    }

    private static ResolvedLoad? Apply(LoadRule? rule, string source, string? group)
    {
        if (rule?.LoadsKg is { Count: > 0 } loads) return new ResolvedLoad(0, loads, source, group);
        return rule?.StepKg is { } step ? new ResolvedLoad(step, null, source, group) : null;
    }
}
