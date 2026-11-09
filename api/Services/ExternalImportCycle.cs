using Workout.Api.Domain;

namespace Workout.Api.Services;

/// A program may repeat a cycle longer than seven days (a ten-day push/pull/legs rotation with its rest days). The file
/// is meant to say so with sourceWeekDays, but an assistant often leaves it out. When every week holds the same number
/// of days, above a normal week and within the supported limit, that count is the cycle the file prints; an uneven
/// file stays a real overflow for the reviewer to settle.
internal static class ExternalImportCycle
{
    public static int? Length(int? stated, IReadOnlyList<DraftWorkout> days)
    {
        if (stated is not null) return stated;
        var counts = days.GroupBy(day => day.Week).Select(group => group.Count()).Distinct().ToList();
        return counts is [var only] && only > ProgramLimits.StandardDaysPerWeek && only <= ProgramLimits.MaxDaysPerWeek ? only : null;
    }
}
