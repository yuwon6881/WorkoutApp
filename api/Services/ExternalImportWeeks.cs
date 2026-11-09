namespace Workout.Api.Services;

/// A document often prints "Block 2, Week 1" again after "Block 1, Week 8", and an assistant copies that number. A
/// program's weeks count through the whole program, so a later block continues after the one before it; otherwise the
/// two blocks share week numbers and pile their days into one week. Only a block change where the printed number
/// goes backwards is read as a restart, so days of different blocks inside one week stay together.
internal static class ExternalImportWeeks
{
    public static List<DraftWorkout> Continue(List<DraftWorkout> days)
    {
        var result = new List<DraftWorkout>(days.Count);
        var offset = 0;
        var furthest = 0;
        DraftWorkout? previous = null;
        foreach (var day in days)
        {
            var block = (day.Block ?? "").Trim();
            if (previous is not null && block.Length > 0 && !string.Equals(block, (previous.Block ?? "").Trim(), StringComparison.OrdinalIgnoreCase)
                && day.Week < previous.Week)
                offset = furthest - day.Week + 1;
            var week = day.Week + offset;
            furthest = Math.Max(furthest, week);
            result.Add(offset == 0 ? day : day with { Week = week });
            previous = day;
        }
        return result;
    }
}
