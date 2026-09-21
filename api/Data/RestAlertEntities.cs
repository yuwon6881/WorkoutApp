namespace Workout.Api.Data;

/// <summary>A push target for one signed-in browser installation.</summary>
public sealed class WorkoutPushDevice : OwnedRecord
{
    public string DeviceId { get; set; } = "";
    public string FcmToken { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A durable generation for one device's active-workout rest reminder. Cloud Tasks is an
/// execution mechanism; this row and the active session are rechecked before every send.
/// </summary>
public sealed class WorkoutRestAlertSchedule : OwnedRecord
{
    public Guid SessionId { get; set; }
    public string DeviceId { get; set; } = "";
    public Guid Generation { get; set; }
    public DateTime Deadline { get; set; }
    public DateTime ExpiresAt { get; set; }
    public string Status { get; set; } = WorkoutRestAlertStatus.Pending;
    public string TaskName { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LeaseUntil { get; set; }
    public DateTime? AcceptedAt { get; set; }
}

public static class WorkoutRestAlertStatus
{
    public const string Pending = "pending";
    public const string Scheduled = "scheduled";
    public const string Dispatching = "dispatching";
    public const string Accepted = "accepted";
    public const string Cancelled = "cancelled";
    public const string Disabled = "disabled";
    public const string Expired = "expired";
    public const string Failed = "failed";
}
