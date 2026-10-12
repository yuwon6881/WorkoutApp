using Workout.Api.Data;

namespace Workout.Api.Services;

/// Reviewed synonyms only. Similar movements, grips, machine loading and bodyweight variants
/// are deliberately separate. Legacy identities remain usable by saved plans and history.
internal static class CatalogSynonyms
{
    private static readonly IReadOnlyDictionary<string, string> Canonical = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["barbell-bench-press"] = "bench-press",
        ["chest-press-machine"] = "machine-chest-press",
        ["weight-stack-chest-press-machine"] = "weight-stack-machine-chest-press",
        ["cable-seated-row"] = "seated-cable-row",
        ["half-kneeling-1-arm-lat-pulldown"] = "1-arm-half-kneeling-lat-pulldown",
        ["db-incline-curl"] = "incline-dumbbell-curl",
        ["db-rdl"] = "db-romanian-deadlift",
        ["cable-reverse-flye"] = "reverse-cable-flye",
        ["bent-over-dumbbell-reverse-flye"] = "bent-over-reverse-db-flye",
        ["barbell-overhead-press"] = "overhead-press"
    };

    public static List<CatalogExercise> Listings(List<CatalogExercise> rows)
    {
        var bySlug = rows.ToDictionary(row => row.Slug, StringComparer.Ordinal);
        var hidden = new HashSet<Guid>();
        foreach (var (legacySlug, canonicalSlug) in Canonical)
        {
            if (!bySlug.TryGetValue(legacySlug, out var legacy) || !bySlug.TryGetValue(canonicalSlug, out var current) ||
                legacy.Equipment != current.Equipment || legacy.LoadModel != current.LoadModel ||
                legacy.TrackingMode != current.TrackingMode) continue;
            bySlug[canonicalSlug] = current with
            {
                Aliases = current.Aliases.Concat(legacy.Aliases).Append(legacy.Name).Distinct(StringComparer.OrdinalIgnoreCase).ToList()
            };
            hidden.Add(legacy.Id);
        }
        return rows.Where(row => !hidden.Contains(row.Id)).Select(row => bySlug[row.Slug]).ToList();
    }

    /// A canonical seed takes ownership of its old spelling aliases, without deleting or
    /// rekeying any exercise referenced by account data. Omitted unrelated rows stay untouched.
    public static HashSet<Guid> AliasOwners(List<Exercise> existing, List<SeedExercise> input)
    {
        var seeded = input.ToDictionary(row => row.Slug, StringComparer.Ordinal);
        return existing.Where(row => !seeded.ContainsKey(row.Slug) && Canonical.TryGetValue(row.Slug, out var slug) &&
            seeded.TryGetValue(slug, out var current) && row.Equipment == current.Equipment &&
            row.LoadModel == current.LoadModel && row.TrackingMode == (current.TrackingMode ?? "reps"))
            .Select(row => row.Id).ToHashSet();
    }
}
