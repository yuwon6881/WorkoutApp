namespace Workout.Api.Data;

/// A place the lifter trains. It owns what that gym lacks and, through GymProfileId on the load
/// rule rows, the weights its equipment offers. Every account keeps at least one.
public sealed class GymProfile : OwnedRecord
{
    public string Name { get; set; } = "";
    /// JSON array of GymEquipment keys this gym does not have. Empty means everything is available.
    public string MissingEquipmentJson { get; set; } = "[]";
    /// JSON object of exercise id to "available" or "unavailable", overriding what the equipment implies.
    public string ExerciseOverridesJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class GymProfileLimits
{
    public const int NameLength = 60;
    public const int MaxProfiles = 20;
}

public static class GymExerciseOverrides
{
    public const string Available = "available";
    public const string Unavailable = "unavailable";

    public static bool IsValid(string value) => value is Available or Unavailable;
}
