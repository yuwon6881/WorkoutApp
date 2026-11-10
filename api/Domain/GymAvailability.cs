namespace Workout.Api.Domain;

/// Whether a gym can host an exercise; the server twin of `gymAvailability` in the web app.
/// A per-exercise choice wins, otherwise every requirement needs at least one alternative the
/// gym has. Nothing missing means everything is available.
public static class GymAvailability
{
    public static bool Hosts(IReadOnlyCollection<string> missingEquipment, IReadOnlyDictionary<string, string> overrides,
        Guid exerciseId, IEnumerable<string>? requires)
    {
        if (overrides.TryGetValue(exerciseId.ToString(), out var choice))
        {
            if (choice == Data.GymExerciseOverrides.Available) return true;
            if (choice == Data.GymExerciseOverrides.Unavailable) return false;
        }
        return (requires ?? []).Select(GymEquipment.Options)
            .All(options => options.Count == 0 || options.Any(key => !missingEquipment.Contains(key)));
    }
}
