namespace Workout.Api.Services;

/// A week or block identity is one fact about every day that shares its week number. The review
/// editor assigns the identities and sends back only the days an exercise edit touched, so the
/// untouched days of a week can still have none; left alone, the editor would read the two groups
/// as two weeks. Whatever identity any day of a week carries is given to the rest of that week.
internal static class ImportStructureIds
{
    public static ImportDraft Unify(ImportDraft draft)
    {
        var weeks = draft.Workouts.GroupBy(day => day.Week).ToDictionary(group => group.Key,
            group => (WeekId: group.Select(day => day.WeekId).FirstOrDefault(id => id is not null),
                      BlockId: group.Select(day => day.BlockId).FirstOrDefault(id => id is not null)));
        var unified = draft.Workouts.Select(day =>
        {
            var (weekId, blockId) = weeks[day.Week];
            return day.WeekId == weekId && day.BlockId == blockId || weekId is null && blockId is null
                ? day
                : day with { WeekId = weekId ?? day.WeekId, BlockId = blockId ?? day.BlockId };
        }).ToList();
        return draft with { Workouts = unified };
    }
}
