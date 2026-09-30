namespace Workout.Api.Domain;

/// Time away from an exercise. Strength is largely retained for about three weeks and falls off after
/// that, so a suggestion built on the last session must not assume the lifter is where they left off.
internal static class ProgressionLayoff
{
    public const int HoldDays = 15;
    public const int ReduceDays = 28;
    public const int LongDays = 56;

    /// Whole days since the newest exposure, or null when the clock or the date is unknown.
    public static int? Days(IReadOnlyList<SetExposure> history, DateTime? now)
        => now is { } current && history.FirstOrDefault() is { } newest && newest.CompletedAt != DateTime.MinValue
            ? Math.Max(0, (int)(current - newest.CompletedAt).TotalDays)
            : null;

    public static double Factor(int days) => days >= LongDays ? .8 : days >= ReduceDays ? .9 : 1;
}
