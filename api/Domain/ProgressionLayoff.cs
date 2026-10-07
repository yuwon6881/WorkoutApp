namespace Workout.Api.Domain;

/// Time away from an exercise. Strength is largely retained for about three weeks and falls off after
/// that, so a suggestion built on the last session must not assume the lifter is where they left off.
/// Any session of the movement counts as training: partials or myo-reps in the slot are not time away.
internal static class ProgressionLayoff
{
    public const int HoldDays = 15;
    public const int ReduceDays = 28;
    public const int LongDays = 56;

    /// Whole days since the newest exposure, or null when the clock or the date is unknown.
    public static int? Days(IReadOnlyList<SetExposure> history, DateTime? now) => Days(Newest(history), now);

    public static int? Days(DateTime? lastTrained, DateTime? now)
        => now is { } current && lastTrained is { } newest ? Math.Max(0, (int)(current - newest).TotalDays) : null;

    /// When the movement was last trained in any form, or null when no exposure carries a date.
    public static DateTime? Newest(IEnumerable<SetExposure> history)
        => history.Where(exposure => exposure.CompletedAt != DateTime.MinValue)
            .Select(exposure => (DateTime?)exposure.CompletedAt).Max();

    public static double Factor(int days) => days >= LongDays ? .8 : days >= ReduceDays ? .9 : 1;
}
