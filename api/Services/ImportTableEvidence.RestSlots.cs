namespace Workout.Api.Services;

internal static partial class ImportTableEvidence
{
    /// A page that ends on a rest-day band ("1-2 Rest Days") schedules one rest day after its
    /// session. The read kept that rest day in some weeks and dropped it in others, and in some it
    /// put it in the wrong slot: Min-Max Phase 2 week 5 read Upper, Lower, Rest, Push, Pull, Rest,
    /// Arms for a page order that ends the week on Arms and its rest band.
    ///
    /// Within one week, when the read's rest days are no more than the bands printed under its
    /// sessions, each rest day is placed straight after the session whose page prints its band and
    /// a band left without one gains one. One day is the least such a band asks for. A week with
    /// more rest days than bands keeps the read's order, since those rests come from elsewhere.
    private static List<AiDay> WithFooterRestDays(List<AiDay> days, Dictionary<int, EvidencePage> pages)
    {
        var output = new List<AiDay>(days.Count);
        var start = 0;
        while (start < days.Count)
        {
            var end = start;
            while (end < days.Count && SameWeek(days[end], days[start])) end++;
            output.AddRange(PlaceRests(days.GetRange(start, end - start), pages));
            start = end;
        }
        return output;
    }

    private static bool SameWeek(AiDay left, AiDay right)
        => left.WeekNumber == right.WeekNumber
           && string.Equals(left.Block ?? "", right.Block ?? "", StringComparison.OrdinalIgnoreCase)
           && string.Equals(left.Phase ?? "", right.Phase ?? "", StringComparison.OrdinalIgnoreCase);

    private static List<AiDay> PlaceRests(List<AiDay> week, Dictionary<int, EvidencePage> pages)
    {
        var training = week.Where(day => !day.IsRestDay).ToList();
        // The session a band follows is the last one read from the band's page.
        var bandAfter = training.Select((day, index) => (day, index))
            .Where(item => item.day.SourcePage is { } page && pages.TryGetValue(page, out var evidence)
                && evidence.HasRestDayFooter && evidence.RestBandFollowsTable
                && !training.Skip(item.index + 1).Any(next => next.SourcePage == page))
            .Select(item => item.index).ToHashSet();
        var rests = new Queue<AiDay>(week.Where(day => day.IsRestDay));
        if (bandAfter.Count == 0 || rests.Count > bandAfter.Count) return week;

        var placed = new List<AiDay>(week.Count + bandAfter.Count - rests.Count);
        for (var index = 0; index < training.Count; index++)
        {
            var day = training[index];
            placed.Add(day);
            if (!bandAfter.Contains(index)) continue;
            placed.Add(rests.Count > 0
                ? rests.Dequeue()
                : new AiDay(day.Block, day.Phase, day.WeekNumber, day.PhaseWeek, "Rest Day", true, null, [], day.SourcePage));
        }
        return placed;
    }
}
