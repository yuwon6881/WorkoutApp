namespace Workout.Api.Domain;

/// The kinds of equipment a lifter can give one account-wide load rule. Groups come from the
/// exercise's equipment field and load model, never from its name. Everything loaded with plates
/// on a bar or sleeve shares the Barbell group, because one set of plates serves them all.
/// Machines have no group: each machine's stack differs, so they are set per exercise.
public static class EquipmentGroups
{
    public const string Barbell = "barbell";
    public const string Dumbbell = "dumbbell";
    public const string Cable = "cable";
    public const string Kettlebell = "kettlebell";
    public const string Plate = "plate";
    public const string MedicineBall = "medicine-ball";
    /// Load added to, or taken off, a full-bodyweight movement such as a weighted pull-up.
    public const string AddedLoad = "added-load";

    /// Group key to the equipment value the catalog prints for it, used for the group's app default.
    /// Added load has none.
    private static readonly Dictionary<string, string> EquipmentByGroup = new(StringComparer.Ordinal)
    {
        [Barbell] = "Barbell",
        [Dumbbell] = "Dumbbell",
        [Cable] = "Cable",
        [Kettlebell] = "Kettlebell",
        [Plate] = "Plate",
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
        ["Plate"] = Plate,
        ["Medicine Ball"] = MedicineBall
    };

    public static readonly IReadOnlyList<string> All = [.. EquipmentByGroup.Keys, AddedLoad];

    public static bool IsKnown(string? group) => group is not null && All.Contains(group);

    /// Null when the exercise has no adjustable external load, or its equipment is not one a
    /// lifter can configure; such an exercise keeps its app default.
    public static string? For(string? equipment, string? loadModel)
    {
        if (loadModel == LoadModels.FullBodyweight) return AddedLoad;
        if (loadModel is LoadModels.BodyweightContextOnly or LoadModels.RepsOnly) return null;
        return GroupByEquipment.GetValueOrDefault((equipment ?? "").Trim());
    }

    /// The step an exercise in this group uses when nobody has set one.
    public static double AppDefaultStep(string group)
        => group == AddedLoad ? Progression.DefaultStepKg : Progression.StepForEquipment(EquipmentByGroup.GetValueOrDefault(group));
}
