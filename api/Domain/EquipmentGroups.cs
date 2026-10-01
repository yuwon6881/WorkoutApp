namespace Workout.Api.Domain;

/// The kinds of equipment a lifter can give one account-wide load rule. Groups come from the
/// exercise's equipment field and load model, never from its name. Everything loaded with plates
/// on a bar, sleeve, held directly, or added to bodyweight shares the Barbell group.
/// Machines have no group: each machine's stack differs, so they are set per exercise.
public static class EquipmentGroups
{
    public const string Barbell = "barbell";
    public const string Dumbbell = "dumbbell";
    public const string Cable = "cable";
    public const string Kettlebell = "kettlebell";
    public const string MedicineBall = "medicine-ball";

    /// Group key to the equipment value the catalog prints for it, used for the group's app default.
    private static readonly Dictionary<string, string> EquipmentByGroup = new(StringComparer.Ordinal)
    {
        [Barbell] = "Barbell",
        [Dumbbell] = "Dumbbell",
        [Cable] = "Cable",
        [Kettlebell] = "Kettlebell",
        [MedicineBall] = "Medicine Ball"
    };

    /// Catalog equipment value to its group. Machines are deliberately absent.
    private static readonly Dictionary<string, string> GroupByEquipment = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Barbell"] = Barbell,
        ["EZ-Bar"] = Barbell,
        ["Trap Bar"] = Barbell,
        ["Smith Machine"] = Barbell,
        ["Plate-Loaded Machine"] = Barbell,
        ["Dumbbell"] = Dumbbell,
        ["Cable"] = Cable,
        ["Kettlebell"] = Kettlebell,
        ["Plate"] = Barbell,
        ["Medicine Ball"] = MedicineBall
    };

    public static readonly IReadOnlyList<string> All = [.. EquipmentByGroup.Keys];

    public static bool IsKnown(string? group) => group is not null && All.Contains(group);

    /// Null when the exercise has no adjustable external load, or its equipment is not one a
    /// lifter can configure; such an exercise keeps its app default.
    public static string? For(string? equipment, string? loadModel)
    {
        if (loadModel == LoadModels.FullBodyweight) return Barbell;
        if (loadModel is LoadModels.BodyweightContextOnly or LoadModels.RepsOnly) return null;
        return GroupByEquipment.GetValueOrDefault((equipment ?? "").Trim());
    }

    /// The step an exercise in this group uses when nobody has set one.
    public static double AppDefaultStep(string group, string unit = WeightUnits.Kg)
        => Progression.StepForEquipment(EquipmentByGroup.GetValueOrDefault(group), unit);

    /// Older stored catalog/custom defaults must follow the revised plate and medicine-ball steps.
    /// A custom exercise stores its default in the unit it was created in; it is read in the
    /// account's unit. Explicit exercise rules still win when the load is resolved.
    public static double ExerciseAppDefault(double storedStepKg, string? equipment, string? loadModel,
        string unit = WeightUnits.Kg, string storedUnit = WeightUnits.Kg)
    {
        var stored = UnitStepConversion.InUnit(storedStepKg, storedUnit, unit, equipment);
        if (loadModel is LoadModels.BodyweightContextOnly or LoadModels.RepsOnly) return stored;
        var eq = (equipment ?? "").Trim().ToLowerInvariant();
        if (unit == WeightUnits.Lb)
        {
            return eq switch
            {
                "medicine ball" when loadModel != LoadModels.FullBodyweight => AppDefaultStep(MedicineBall, unit),
                "dumbbell" => AppDefaultStep(Dumbbell, unit),
                "cable" => AppDefaultStep(Cable, unit),
                "kettlebell" => AppDefaultStep(Kettlebell, unit),
                "plate" or "barbell" or "ez-bar" or "trap bar" or "smith machine" or "plate-loaded machine" => AppDefaultStep(Barbell, unit),
                _ => stored
            };
        }
        return eq switch
        {
            "plate" => AppDefaultStep(Barbell, unit),
            "medicine ball" when loadModel != LoadModels.FullBodyweight => AppDefaultStep(MedicineBall, unit),
            _ => stored
        };
    }
}
