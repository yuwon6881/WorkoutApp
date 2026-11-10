using Workout.Api.Domain;

namespace Workout.Api.Services;

/// A machine built both ways is two library entries ("Plate-Loaded Leg Curl" and its
/// "weight-stack-" twin), and only the plate-loaded one answers to the plain name. A document that
/// writes "Leg Curl" never says which build it means, so the plain name follows the active gym: when
/// the gym cannot host the plate-loaded machine but can host the weight-stack one, it means that one.
/// A name that states the build keeps its entry, and a gym that can host both, or neither, keeps the
/// library's default so nothing is guessed from silence.
internal static class CatalogGymAliases
{
    private const string StackPrefix = "weight-stack-";

    public static Dictionary<string, Guid> Apply(Dictionary<string, Guid> index, IReadOnlyList<CatalogExercise> shared, GymProfileView gym)
    {
        var missing = gym.MissingEquipment.ToHashSet(StringComparer.Ordinal);
        var bySlug = shared.GroupBy(x => x.Slug, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var moves = new Dictionary<Guid, (CatalogExercise Plate, Guid StackId)>();
        foreach (var stack in shared.Where(x => x.Slug.StartsWith(StackPrefix, StringComparison.Ordinal)))
        {
            if (!bySlug.TryGetValue(stack.Slug[StackPrefix.Length..], out var plate)) continue;
            if (GymAvailability.Hosts(missing, gym.ExerciseOverrides, plate.Id, plate.Requires)) continue;
            if (!GymAvailability.Hosts(missing, gym.ExerciseOverrides, stack.Id, stack.Requires)) continue;
            moves[plate.Id] = (plate, stack.Id);
        }
        if (moves.Count == 0) return index;

        // The entry's own name, and the spellings of it, stay put: that is a document naming the build.
        var named = moves.ToDictionary(move => move.Key, move =>
        {
            var name = CatalogService.Normalize(move.Value.Plate.Name);
            return CatalogMatching.LibraryKeys(name).Append(name).ToHashSet(StringComparer.Ordinal);
        });
        var output = new Dictionary<string, Guid>(index, StringComparer.Ordinal);
        foreach (var (key, id) in index)
            if (moves.TryGetValue(id, out var move) && !named[id].Contains(key)) output[key] = move.StackId;
        return output;
    }
}
