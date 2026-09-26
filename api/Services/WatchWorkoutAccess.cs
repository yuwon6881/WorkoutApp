using System.Text.Json;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Narrows what a paired watch can see and change to the live session. A device token is a
/// long-lived credential on a small, easily lost device, so it never reads history and only
/// changes the values a lifter logs from the wrist; everything else stays on the phone.
public static class WatchWorkoutAccess
{
    private static readonly HashSet<string> SetPatchFields =
        ["revision", "mutationId", "weightKg", "reps", "rpe", "rir", "done"];

    /// A finished or discarded workout reads as gone, which tells the watch to drop edits that
    /// can no longer apply instead of retrying them against saved history.
    public static async Task<SessionView> ActiveSession(WorkoutService workouts, Guid id, CancellationToken ct)
    {
        var active = await workouts.Active(ct);
        Validation.Require(active is not null && active.Id == id, "This workout is no longer active in WorkoutApp.", 404);
        return active!;
    }

    /// Drops set-shape fields (warm-up flag, resistance mode) so a watch cannot restructure the
    /// session. Earlier watch builds echoed those fields unchanged, so dropping them is lossless.
    public static JsonElement SetPatch(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object) return payload;
        var filtered = new Dictionary<string, JsonElement>();
        foreach (var property in payload.EnumerateObject())
            if (SetPatchFields.Contains(property.Name)) filtered[property.Name] = property.Value.Clone();
        return JsonSerializer.SerializeToElement(filtered);
    }
}
