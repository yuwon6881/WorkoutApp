namespace Workout.Api.Services;

internal static partial class ImportTableEvidence
{
    internal sealed record PrintedPageRead(AiProgram Program, HashSet<int> Pages);

    public static bool HasRowsOutside(SourceRead source, IReadOnlySet<int> schedulePages)
        => source.Pages.Any(item => !schedulePages.Contains(item.Key) && TableRows(item.Value).Count > 0);

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
        var source = Analyze(sectionText);
        return ReadPrintedSection(schedule, source, 1, ImportSourceText.MaxPages);
    }

    public static AiProgram? ReadPrintedSection(IReadOnlyList<ImportPrintedSchedule.SourceDay> schedule,
        SourceRead source, int pageFrom, int pageTo)
    {
        var parsed = ReadPrintedPages(schedule, source, pageFrom, pageTo);
        var pages = source.Pages.Where(item => item.Key >= pageFrom && item.Key <= pageTo).ToDictionary(item => item.Key, item => item.Value);
        var scheduled = schedule.Where(day => day.Page >= pageFrom && day.Page <= pageTo && pages.ContainsKey(day.Page)).ToList();
        if (scheduled.Count == 0) return null;
        var scheduledPages = scheduled.Select(day => day.Page).ToHashSet();
        if (pages.Any(item => TableRows(item.Value).Count > 0 && (!scheduledPages.Contains(item.Key) || !IsClean(item.Value))))
            return null;

        var tablePages = pages.Where(item => TableRows(item.Value).Count > 0).Select(item => item.Key).ToHashSet();
        return parsed is not null && tablePages.SetEquals(parsed.Pages) ? parsed.Program : null;
    }

    /// Reads only complete, clean day groups from a mixed section. Other pages remain available
    /// for the model, so one paragraph or ambiguous table does not force healthy tables to be read
    /// again. A page is accepted only when every printed row has one unambiguous day owner.
    public static PrintedPageRead? ReadPrintedPages(IReadOnlyList<ImportPrintedSchedule.SourceDay> schedule,
        SourceRead source, int pageFrom, int pageTo)
    {
        var days = new List<AiDay>();
        var readPages = new HashSet<int>();
        foreach (var page in schedule.Where(day => day.Page >= pageFrom && day.Page <= pageTo).GroupBy(day => day.Page))
        {
            if (!source.Pages.TryGetValue(page.Key, out var evidence) || !IsClean(evidence)) continue;
            var printed = page.ToList();
            var rows = TableRows(evidence);
            if (rows.Count == 0) continue;
            var owned = printed.Select((day, index) => RowsFor(day.Label, evidence, printed.Count, index)).ToList();
            if (owned.Any(group => group.Count == 0) || owned.Sum(group => group.Count) != rows.Count
                || owned.SelectMany(group => group).Distinct(ReferenceEqualityComparer.Instance).Count() != rows.Count)
                continue;

            var pageDays = new List<AiDay>();
            for (var index = 0; index < printed.Count; index++)
            {
                var day = printed[index];
                pageDays.Add(new AiDay(day.Block, null, day.Week, day.PhaseWeek, day.Label, false, null,
                    RecoverPrintedRows([], owned[index], evidence, page.Key, day.Label, false), page.Key));
                pageDays.AddRange(Enumerable.Range(0, day.RestsAfter).Select(_ =>
                    new AiDay(day.Block, null, day.Week, day.PhaseWeek, "Rest Day", true, null, [], page.Key)));
            }
            if (!pageDays.Any(day => !day.IsRestDay && day.Exercises.Count > 0)) continue;
            days.AddRange(pageDays);
            readPages.Add(page.Key);
        }
        if (readPages.Count == 0) return null;
        return new PrintedPageRead(new AiProgram(null, days), readPages);
    }

    public static bool HasCompleteDayGroup(IReadOnlyList<ImportPrintedSchedule.SourceDay> schedule,
        SourceRead source, int pageNumber)
    {
        if (!source.Pages.TryGetValue(pageNumber, out var evidence)) return false;
        var rows = TableRows(evidence);
        var days = schedule.Where(day => day.Page == pageNumber && !day.IsRestDay).ToList();
        if (rows.Count == 0 || days.Count == 0) return false;
        var owned = days.Select((day, index) => RowsFor(day.Label, evidence, days.Count, index)).ToList();
        return owned.All(group => group.Count > 0) && owned.Sum(group => group.Count) == rows.Count
            && owned.SelectMany(group => group).Distinct(ReferenceEqualityComparer.Instance).Count() == rows.Count;
    }

}
