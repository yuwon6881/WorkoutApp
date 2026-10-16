namespace Workout.Api.Services;

/// History cursors refer to UTC database instants. A legacy cursor without a zone uses UTC too.
public static class HistoryCursorTime
{
    public static DateTime Utc(DateTime value) => value.Kind == DateTimeKind.Unspecified
        ? DateTime.SpecifyKind(value, DateTimeKind.Utc)
        : value.ToUniversalTime();
}
