namespace Workout.Api.Services;

/// Which weekday each imported day falls on.
///
/// A written program almost never names weekdays. It prints a week as an ordered list — Upper 1,
/// Lower 1, Rest, Upper 2, Lower 2 — and the order is the schedule: the first session is the
/// week's first day, the next is its second, and a rest day printed between them takes its turn
/// like any other. Asking a reviewer to choose a weekday for every day turned a ninety-day program
/// into ninety blocking questions with one obvious answer each.
///
/// So the order the document printed is read as the schedule it is. A week of five sessions
/// becomes Monday to Friday with the weekend free; a week that prints its own rest days keeps them
/// exactly where they fall. A weekday the document did state is never overruled — the days around
/// it fill in about it — and the schedule stays editable when the program is activated.
internal static class ImportSchedule
{
    private const int DaysInWeek = 7;

    public static List<DraftWorkout> Assign(List<DraftWorkout> workouts)
    {
        var assigned = new Dictionary<Guid, int>();
        foreach (var week in workouts.GroupBy(day => (Block: day.Block?.Trim() ?? "", Phase: day.Phase?.Trim() ?? "", day.Week)))
        {
            // The document's own order, which is the order the days were read in.
            var days = week.ToList();
            var taken = days.Where(day => day.Weekday is not null).Select(day => day.Weekday!.Value).ToHashSet();
            var cursor = 1;
            foreach (var day in days)
            {
                if (day.Weekday is { } stated)
                {
                    // A stated weekday is what the page said; the days after it carry on from there.
                    cursor = Math.Max(cursor, stated + 1);
                    continue;
                }
                while (cursor <= DaysInWeek && !taken.Add(cursor)) cursor++;
                // A week with more days than there are weekdays cannot place the rest of them, and
                // says nothing rather than stacking two sessions onto one day.
                if (cursor > DaysInWeek) break;
                assigned[day.LineId] = cursor;
                cursor++;
            }
        }
        if (assigned.Count == 0) return workouts;
        return workouts.Select(day => assigned.TryGetValue(day.LineId, out var weekday) ? day with { Weekday = weekday } : day).ToList();
    }
}
