using System.Globalization;
using System.Text.Json;
using Workout.Api.Data;

namespace Workout.Api.Services;

public sealed partial class GoogleHealthWorkoutSyncService
{
    public static DateTimeOffset FormatTimestamp(DateTime time, string? timeZone)
    {
        TimeZoneInfo zone;
        try
        {
            zone = string.IsNullOrWhiteSpace(timeZone)
                ? TimeZoneInfo.Utc
                : TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            zone = TimeZoneInfo.Utc;
        }

        var utcTime = DateTime.SpecifyKind(time, DateTimeKind.Utc);
        return TimeZoneInfo.ConvertTime(new DateTimeOffset(utcTime), zone);
    }

    public static GoogleHealthWorkoutDataPoint BuildDataPoint(
        DateTime startedAt, DateTime? finishedAt, string name, string notes, string? timeZone)
    {
        var start = FormatTimestamp(startedAt, timeZone);
        var finish = finishedAt.HasValue
            ? FormatTimestamp(finishedAt.Value, timeZone)
            : start.AddMinutes(45);

        return new GoogleHealthWorkoutDataPoint(
            start.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
            finish.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
            string.IsNullOrWhiteSpace(name) ? "Workout" : name.Trim(),
            "WEIGHTLIFTING",
            notes ?? "");
    }

    private static void CancelWork(GoogleHealthWorkoutSyncWork work)
    {
        work.ProcessingState = "cancelled";
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.NextAttemptAt = DateTime.MaxValue;
        work.GoogleOperationName = "";
        work.RetryCount = 0;
        work.LastErrorCategory = "";
        work.LastErrorMessage = "";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static bool CanDispatch(GoogleHealthConnection connection)
        => connection.Status == "connected" && connection.WorkoutSyncEnabled && HasWorkoutScope(connection);

    private static bool HasWorkoutScope(GoogleHealthConnection connection)
    {
        try
        {
            var scopes = JsonSerializer.Deserialize<string[]>(connection.GrantedScopesJson, Json.Options) ?? [];
            return scopes.Contains(WorkoutScope, StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private sealed record WorkoutWorkLease(
        Guid UserId,
        Guid WorkId,
        string LeaseId,
        long DesiredRevision,
        DateTime StartedAt,
        DateTime FinishedAt,
        string Name,
        string Notes,
        bool Deleted,
        string ResourceName,
        string OperationName,
        long ConnectionGeneration,
        string GoogleIdHash);
}
