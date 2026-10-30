namespace Workout.Api.Domain;

/// One thing a gym can lack. A machine built both ways appears once per build (Variant), grouped
/// under its Machine name, because a gym often has only the weight-stack or the plate-loaded one.
public sealed record GymEquipmentItem(string Key, string Label, string Group, string? Machine = null, string? Variant = null);

/// The equipment a gym profile can mark missing, and what each exercise needs. Requirements are
/// seed-owned; each one lists keys separated by '|', any of which satisfies it. Nothing missing
/// means everything is available, so an item added later never raises a warning by itself.
public static class GymEquipment
{
    public const string FreeWeights = "free-weights";
    public const string BenchesAndRacks = "benches-racks";
    public const string Cables = "cables";
    public const string Machines = "machines";
    public const string PlateVariant = "plate";
    public const string StackVariant = "stack";

    public static readonly IReadOnlyList<GymEquipmentItem> Items = Build();

    private static readonly HashSet<string> Keys = Items.Select(item => item.Key).ToHashSet(StringComparer.Ordinal);

    public static bool IsKnown(string key) => Keys.Contains(key);

    /// How a warning names the item: a machine built both ways says which build is missing.
    public static string DisplayName(GymEquipmentItem item)
        => item.Machine is null ? item.Label : $"{item.Machine} ({item.Label.ToLowerInvariant()})";

    /// A requirement is valid when it names at least one key and every key it names exists.
    public static bool IsValidRequirement(string requirement)
    {
        var options = Options(requirement);
        return options.Count > 0 && options.All(IsKnown);
    }

    public static IReadOnlyList<string> Options(string requirement)
        => requirement.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// A custom exercise has no curated requirement; its equipment value is the only evidence.
    /// A machine is too broad to name one item, so it needs nothing until the lifter marks it.
    public static IReadOnlyList<string> ForEquipment(string? equipment) => (equipment ?? "").Trim().ToLowerInvariant() switch
    {
        "barbell" => ["barbell"],
        "ez-bar" => ["ez-bar"],
        "trap bar" => ["trap-bar"],
        "dumbbell" or "dumbbells" => ["dumbbells"],
        "kettlebell" or "kettlebells" => ["kettlebells"],
        "plate" or "plates" => ["plates"],
        "medicine ball" => ["medicine-ball"],
        "band" or "bands" => ["bands"],
        "smith machine" => ["smith-machine"],
        "cable" => ["cable-station|lat-pulldown|cable-row"],
        _ => []
    };

    private static List<GymEquipmentItem> Build()
    {
        var items = new List<GymEquipmentItem>
        {
            new("barbell", "Barbell", FreeWeights),
            new("ez-bar", "EZ bar", FreeWeights),
            new("trap-bar", "Trap bar", FreeWeights),
            new("dumbbells", "Dumbbells", FreeWeights),
            new("kettlebells", "Kettlebells", FreeWeights),
            new("plates", "Weight plates", FreeWeights),
            new("medicine-ball", "Medicine ball", FreeWeights),
            new("bands", "Resistance bands", FreeWeights),
            new("squat-rack", "Squat rack", BenchesAndRacks),
            new("flat-bench", "Flat bench", BenchesAndRacks),
            new("adjustable-bench", "Adjustable bench", BenchesAndRacks),
            new("decline-bench", "Decline bench", BenchesAndRacks),
            new("preacher-bench", "Preacher bench", BenchesAndRacks),
            new("pull-up-bar", "Pull-up bar", BenchesAndRacks),
            new("dip-station", "Dip station", BenchesAndRacks),
            new("back-extension", "Back extension bench", BenchesAndRacks),
            new("ghd", "Glute-ham developer", BenchesAndRacks),
            new("landmine", "Landmine", BenchesAndRacks),
            new("t-bar-row", "T-bar row station", BenchesAndRacks),
            new("cable-station", "Adjustable cable", Cables),
            new("lat-pulldown", "Lat pulldown", Cables),
            new("cable-row", "Seated cable row", Cables),
            new("smith-machine", "Smith machine", Machines),
            new("hack-squat", "Hack squat", Machines),
            new("pendulum-squat", "Pendulum squat", Machines),
            new("belt-squat", "Belt squat", Machines),
            new("hip-abduction", "Hip abduction machine", Machines),
            new("hip-adduction", "Hip adduction machine", Machines),
            new("triceps-machine", "Triceps machine", Machines),
            new("assisted-pull-up", "Assisted pull-up and dip machine", Machines),
            new("reverse-hyper", "Reverse hyper", Machines)
        };
        (string Key, string Label)[] builtBothWays =
        [
            ("leg-press", "Leg press"),
            ("machine-squat", "Squat machine"),
            ("leg-extension", "Leg extension"),
            ("lying-leg-curl", "Lying leg curl"),
            ("seated-leg-curl", "Seated leg curl"),
            ("hip-thrust", "Hip thrust machine"),
            ("glute-kickback", "Glute kickback machine"),
            ("standing-calf", "Standing calf raise"),
            ("seated-calf", "Seated calf raise"),
            ("chest-press", "Chest press"),
            ("incline-press", "Incline chest press"),
            ("pec-deck", "Pec deck and rear delt fly"),
            ("machine-pulldown", "Pulldown machine"),
            ("high-row", "High row machine"),
            ("machine-row", "Row machine"),
            ("pullover", "Pullover machine"),
            ("shoulder-press", "Shoulder press machine"),
            ("lateral-raise", "Lateral raise machine"),
            ("preacher-curl", "Preacher curl machine"),
            ("shrug-machine", "Shrug machine"),
            ("crunch-machine", "Ab crunch machine"),
            ("dip-machine", "Dip machine")
        ];
        foreach (var (key, label) in builtBothWays)
        {
            items.Add(new($"{key}.{PlateVariant}", "Plate-loaded", Machines, label, PlateVariant));
            items.Add(new($"{key}.{StackVariant}", "Weight stack", Machines, label, StackVariant));
        }
        return items;
    }
}
