namespace Workout.Api.Domain;

/// A machine's or cable stack's number means something only on that machine: the same pin on
/// another gym's leg press or pulley is a different load. Progression for these reads history
/// from the workout's own gym. Free weights and bodyweight weigh the same everywhere.
public static class GymScopedHistory
{
    private static readonly HashSet<string> Scoped = new(StringComparer.OrdinalIgnoreCase)
    {
        "Machine", "Smith Machine", "Plate-Loaded Machine", "Cable"
    };

    public static bool Applies(string? equipment) => Scoped.Contains((equipment ?? "").Trim());
}
