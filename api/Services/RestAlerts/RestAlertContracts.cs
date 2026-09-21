namespace Workout.Api.Services.RestAlerts;

public sealed record WorkoutRestAlertScheduleResult(bool Scheduled, Guid? Generation, string Message);
public sealed record WorkoutPushContent(
    string Title,
    string Body,
    string Tag,
    string Route,
    TimeSpan TimeToLive,
    string SessionId,
    string Generation);

public enum WorkoutPushSendStatus
{
    Accepted,
    InvalidOrUnregistered,
    TransientFailure
}

public sealed record WorkoutPushSendResult(WorkoutPushSendStatus Status);

public interface IWorkoutPushSender
{
    bool Configured { get; }
    Task<WorkoutPushSendResult> SendAsync(string token, WorkoutPushContent content, CancellationToken ct);
}

public interface IWorkoutRestTaskQueue
{
    bool Configured { get; }
    string TaskName(Guid scheduleId);
    Task<bool> EnsureTaskAsync(Workout.Api.Data.WorkoutRestAlertSchedule schedule, CancellationToken ct);
    Task<bool> DeleteTaskAsync(string taskName, CancellationToken ct);
}

public interface IGoogleAccessTokenProvider
{
    Task<string> GetAccessTokenAsync(string scope, CancellationToken ct);
}

public interface ICloudTaskTokenValidator
{
    Task<bool> IsTrustedAsync(string? authorizationHeader, CancellationToken ct);
}

public sealed record RestAlertTaskResult(string Status)
{
    public bool Retry => Status == "retry";
}
