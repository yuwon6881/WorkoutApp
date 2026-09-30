namespace Workout.Api.Data;

public static class WorkoutRestStatus
{
    public const string Idle = "idle";
    public const string Running = "running";
    public const string Paused = "paused";
    public const string Elapsed = "elapsed";
    public static readonly string[] All = [Idle, Running, Paused, Elapsed];
}
