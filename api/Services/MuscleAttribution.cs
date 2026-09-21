namespace Workout.Api.Services;

public static class MuscleRegions
{
    public const string Neck = "Neck";
    public const string Traps = "Traps";
    public const string Shoulders = "Shoulders";
    public const string Chest = "Chest";
    public const string Back = "Back";
    public const string Biceps = "Biceps";
    public const string Triceps = "Triceps";
    public const string Forearms = "Forearms";
    public const string Core = "Core";
    public const string Glutes = "Glutes";
    public const string Quads = "Quads";
    public const string Hamstrings = "Hamstrings";
    public const string Adductors = "Adductors";
    public const string Calves = "Calves";

    public static readonly IReadOnlyList<string> All =
    [
        Neck, Traps, Shoulders, Chest, Back, Biceps, Triceps, Forearms,
        Core, Glutes, Quads, Hamstrings, Adductors, Calves
    ];
}

public readonly record struct MuscleCredit(string Region, double Weight);

/// Maps the free-text catalog and imported exercise labels to the regions the UI can display.
/// Direct work is split across multiple keyword refinements so a single working set contributes
/// one direct set in total; secondary work is additive at half weight.
public static class MuscleAttribution
{
    public const double PrimaryWeight = 1.0;
    public const double SecondaryWeight = 0.5;

    private static readonly string[] PosteriorChain = [MuscleRegions.Hamstrings, MuscleRegions.Glutes];
    private static readonly string[] BicepsAndForearms = [MuscleRegions.Biceps, MuscleRegions.Forearms];
    private static readonly string[] TrapsCalvesAndHips = [MuscleRegions.Traps, MuscleRegions.Calves, MuscleRegions.Glutes];
    private static readonly string[] AdductorsAndNeck = [MuscleRegions.Adductors, MuscleRegions.Neck];

    public static IReadOnlyList<MuscleCredit> For(string? exerciseName, string? primaryMuscle,
        IEnumerable<string>? secondaryMuscles)
    {
        var name = CatalogService.Normalize(exerciseName ?? "");
        var credits = PrimaryFor(exerciseName, primaryMuscle).ToDictionary(credit => credit.Region, credit => credit.Weight,
            StringComparer.Ordinal);

        foreach (var secondary in secondaryMuscles ?? [])
            if (TryRegion(CatalogService.Normalize(secondary ?? ""), out var secondaryRegion))
                Add(credits, secondaryRegion, SecondaryWeight);

        foreach (var secondaryRegion in MovementSecondaries(name))
            Add(credits, secondaryRegion, SecondaryWeight);

        return credits.Select(pair => new MuscleCredit(pair.Key, pair.Value))
            .OrderBy(credit => MuscleRegions.All.ToList().IndexOf(credit.Region)).ToList();
    }

    internal static IReadOnlyList<MuscleCredit> PrimaryFor(string? exerciseName, string? primaryMuscle)
    {
        var name = CatalogService.Normalize(exerciseName ?? "");
        var primaryKey = CatalogService.Normalize(primaryMuscle ?? "");
        var credits = new Dictionary<string, double>(StringComparer.Ordinal);

        if (TryRegion(primaryKey, out var region))
            Add(credits, region, PrimaryWeight);
        else if (IsBucket(primaryKey))
        {
            var refined = Refine(primaryKey, name);
            if (refined.Count == 0) AddDistributed(credits, BucketRegions(primaryKey), PrimaryWeight);
            else foreach (var refinedRegion in refined) Add(credits, refinedRegion, PrimaryWeight);
        }
        else
        {
            // Imported unmatched exercises have no catalog profile. High-confidence names still
            // get the same compound-bucket refinement; an unrecognised label stays unattributed.
            foreach (var refinedRegion in RefineAnyBucket(name)) Add(credits, refinedRegion, PrimaryWeight);
        }

        return credits.Select(pair => new MuscleCredit(pair.Key, pair.Value))
            .OrderBy(credit => MuscleRegions.All.ToList().IndexOf(credit.Region)).ToList();
    }

    private static List<string> Refine(string bucket, string name) => bucket switch
    {
        "posterior chain" => PosteriorRefinement(name),
        "biceps and forearms" => ArmRefinement(name),
        "traps calves and hips" => TrapCalfHipRefinement(name),
        "adductors and neck" => AdductorNeckRefinement(name),
        _ => []
    };

    private static List<string> RefineAnyBucket(string name)
    {
        // Resolve the most specific compound patterns first. A leg curl is hamstring work even
        // though its label also contains the generic word "curl" used for biceps exercises.
        return FirstRefinement(
            PosteriorRefinement(name),
            AdductorNeckRefinement(name),
            TrapCalfHipRefinement(name),
            ArmRefinement(name));
    }

    private static List<string> FirstRefinement(params List<string>[] candidates)
        => candidates.FirstOrDefault(candidate => candidate.Count > 0) ?? [];

    private static List<string> PosteriorRefinement(string name)
    {
        if (HasAny(name, "leg curl", "hamstring", "nordic", "glute ham")) return [MuscleRegions.Hamstrings];
        if (HasAny(name, "hip thrust")) return [MuscleRegions.Glutes];
        if (HasAny(name, "deadlift", "rdl", "good morning", "hyperextension", "pull through"))
            return PosteriorChain.ToList();
        return [];
    }

    private static List<string> ArmRefinement(string name)
    {
        if (HasAny(name, "wrist", "pinch", "hold", "farmer")) return [MuscleRegions.Forearms];
        if (HasAny(name, "hammer", "zottman")) return BicepsAndForearms.ToList();
        if (HasWord(name, "curl")) return [MuscleRegions.Biceps];
        return [];
    }

    private static List<string> TrapCalfHipRefinement(string name)
    {
        if (HasAny(name, "calf", "toe press")) return [MuscleRegions.Calves];
        if (HasAny(name, "abduction", "band walk")) return [MuscleRegions.Glutes];
        if (HasWord(name, "shrug")) return [MuscleRegions.Traps];
        return [];
    }

    private static List<string> AdductorNeckRefinement(string name)
    {
        if (HasWord(name, "adduction")) return [MuscleRegions.Adductors];
        if (HasWord(name, "neck")) return [MuscleRegions.Neck];
        return [];
    }

    private static List<string> BucketRegions(string bucket) => bucket switch
    {
        "posterior chain" => PosteriorChain.ToList(),
        "biceps and forearms" => BicepsAndForearms.ToList(),
        "traps calves and hips" => TrapsCalvesAndHips.ToList(),
        "adductors and neck" => AdductorsAndNeck.ToList(),
        _ => []
    };

    private static bool IsBucket(string value) => BucketRegions(value).Count > 0;

    private static void AddDistributed(Dictionary<string, double> credits, IReadOnlyList<string> regions, double weight)
    {
        if (regions.Count == 0) return;
        var share = weight / regions.Distinct(StringComparer.Ordinal).Count();
        foreach (var region in regions) Add(credits, region, share);
    }

    private static void Add(Dictionary<string, double> credits, string region, double weight)
    {
        if (!credits.TryGetValue(region, out var existing) || weight > existing)
            credits[region] = weight;
    }

    private static bool TryRegion(string value, out string region)
    {
        region = MuscleRegions.All.FirstOrDefault(candidate => CatalogService.Normalize(candidate) == value) ?? "";
        return region.Length > 0;
    }

    private static IEnumerable<string> MovementSecondaries(string name)
    {
        if (name.Length == 0) return [];

        var regions = new List<string>();
        var calfPress = HasAny(name, "calf raise", "calf press", "toe press");
        if (HasAny(name, "squat", "lunge") || (HasAny(name, "leg press") && !calfPress))
            regions.Add(MuscleRegions.Glutes);
        if (HasAny(name, "deadlift", "rdl", "good morning", "hyperextension", "pull through"))
            regions.Add(MuscleRegions.Back);

        if (HasAny(name, "overhead press", "military press", "strict press", "push press", "arnold press"))
            regions.Add(MuscleRegions.Triceps);
        else if (HasAny(name, "bench press", "chest press", "push up", "pushup", "shoulder press", "incline press", "decline press", "floor press", "landmine press"))
        {
            regions.Add(MuscleRegions.Triceps);
            regions.Add(MuscleRegions.Shoulders);
        }

        if (HasAny(name, "row", "pulldown", "pull up", "pullup")) regions.Add(MuscleRegions.Biceps);
        return regions.Distinct(StringComparer.Ordinal);
    }

    private static bool HasWord(string normalizedName, string word)
        => $" {normalizedName} ".Contains($" {word} ", StringComparison.Ordinal);

    private static bool HasAny(string normalizedName, params string[] phrases)
        => phrases.Any(phrase => $" {normalizedName} ".Contains($" {phrase} ", StringComparison.Ordinal));
}
