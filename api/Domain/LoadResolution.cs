namespace Workout.Api.Domain;

/// One stored load rule: a fixed step, a list of the weights that exist, or a named stack. A rule
/// with none of them is empty and says nothing.
public sealed record LoadRule(double? StepKg, IReadOnlyList<double>? LoadsKg, Guid? StackId)
{
    public static readonly LoadRule Empty = new(null, null, null);
}

/// A named set of weights, or a step, shared by every exercise and equipment default that uses it.
public sealed record LoadStackRule(Guid Id, string Name, double? StepKg, IReadOnlyList<double>? LoadsKg);

public static class LoadSources
{
    public const string Exercise = "exercise";
    public const string Equipment = "equipment";
    public const string App = "app";
}

/// The load rule an exercise is progressed with, and where it came from so the app can say so.
/// With a weight list the list decides every load and the step is zero.
public sealed record ResolvedLoad(double StepKg, IReadOnlyList<double>? AvailableLoadsKg, string Source,
    string? EquipmentGroup, string? StackName);

public static class LoadResolution
{
    /// The exercise's own rule wins, then the account's rule for its equipment, then the app
    /// default. A rule naming a stack that no longer exists falls through rather than becoming zero.
    public static ResolvedLoad Resolve(double appStepKg, string? equipmentGroup, LoadRule? exercise, LoadRule? equipment,
        IReadOnlyDictionary<Guid, LoadStackRule> stacks)
    {
        if (Apply(exercise, stacks, LoadSources.Exercise, equipmentGroup) is { } own) return own;
        if (equipmentGroup is not null && Apply(equipment, stacks, LoadSources.Equipment, equipmentGroup) is { } shared) return shared;
        return new ResolvedLoad(appStepKg, null, LoadSources.App, equipmentGroup, null);
    }

    private static ResolvedLoad? Apply(LoadRule? rule, IReadOnlyDictionary<Guid, LoadStackRule> stacks, string source, string? group)
    {
        if (rule is null) return null;
        if (rule.StackId is { } stackId)
            return stacks.TryGetValue(stackId, out var stack) ? Concrete(stack.StepKg, stack.LoadsKg, source, group, stack.Name) : null;
        return Concrete(rule.StepKg, rule.LoadsKg, source, group, null);
    }

    private static ResolvedLoad? Concrete(double? stepKg, IReadOnlyList<double>? loadsKg, string source, string? group, string? stackName)
    {
        if (loadsKg is { Count: > 0 }) return new ResolvedLoad(0, loadsKg, source, group, stackName);
        return stepKg is { } step ? new ResolvedLoad(step, null, source, group, stackName) : null;
    }
}
