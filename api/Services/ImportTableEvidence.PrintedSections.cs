namespace Workout.Api.Services;

internal static partial class ImportTableEvidence
{
    /// Reads a section straight from its printed tables, with no model call, when nothing on its
    /// pages needs interpreting: the printed schedule places each of its days, every page that
    /// carries table rows is a clean table on a schedule page, and each printed day resolves to its
    /// own rows with none left over. Null sends the section to the model as before.
    ///
    /// On such pages the model's reading was already being replaced by these rows row for row; what
    /// it added (catalog ids, which the request never carries, and free-text notes) the table either
    /// prints in its own columns or does not state at all.
    public static AiProgram? ReadPrintedSection(IReadOnlyList<ImportPrintedSchedule.SourceDay> schedule, string sectionText)
    {
        var pages = Read(sectionText);
        var scheduled = schedule.Where(day => pages.ContainsKey(day.Page)).ToList();
        if (scheduled.Count == 0) return null;
        var scheduledPages = scheduled.Select(day => day.Page).ToHashSet();
        if (pages.Any(item => TableRows(item.Value).Count > 0 && (!scheduledPages.Contains(item.Key) || !IsClean(item.Value))))
            return null;

        var days = new List<AiDay>();
        foreach (var page in scheduled.GroupBy(day => day.Page))
        {
            var evidence = pages[page.Key];
            var printed = page.ToList();
            var owned = printed.Select((day, index) => RowsFor(day.Label, evidence, printed.Count, index)).ToList();
            // Every row belongs to exactly one printed day, or the page holds a table no label names.
            if (owned.Any(rows => rows.Count == 0) || owned.Sum(rows => rows.Count) != TableRows(evidence).Count
                || owned.SelectMany(rows => rows).Distinct(ReferenceEqualityComparer.Instance).Count() != TableRows(evidence).Count)
                return null;
            for (var index = 0; index < printed.Count; index++)
            {
                var day = printed[index];
                days.Add(new AiDay(day.Block, null, day.Week, day.PhaseWeek, day.Label, false, null,
                    RecoverPrintedRows([], owned[index], evidence, page.Key, day.Label, false), page.Key));
                days.AddRange(Enumerable.Range(0, day.RestsAfter).Select(_ =>
                    new AiDay(day.Block, null, day.Week, day.PhaseWeek, "Rest Day", true, null, [], page.Key)));
            }
        }
        return days.Any(day => !day.IsRestDay && day.Exercises.Count > 0) ? new AiProgram(null, days) : null;
    }
}
