namespace Workout.Api.Services;

internal static partial class ImportTableEvidence
{
    /// A clean page that prints a day label the read has no day for gains that day from its
    /// printed rows. It is added only when the page's other days each answer to one of its labels,
    /// so the labels left over are exactly the days missing, and only on a page between the first
    /// and last the read cites, since pages outside that span may belong to another section.
    private static List<AiDay> WithMissingDays(List<AiDay> days, Dictionary<int, EvidencePage> pages)
    {
        var cited = days.Select(day => day.SourcePage ?? UniqueSourcePage(day.Exercises)).OfType<int>().ToList();
        if (cited.Count == 0) return days;
        var output = days.ToList();
        foreach (var (number, page) in pages.Where(item => item.Key >= cited.Min() && item.Key <= cited.Max()).OrderBy(item => item.Key))
        {
            if (!IsClean(page)) continue;
            var labels = TableRows(page).Select(row => row.DayLabel).OfType<string>()
                .DistinctBy(NormalizeName).ToList();
            var onPage = output.Where(day => !day.IsRestDay && (day.SourcePage ?? UniqueSourcePage(day.Exercises)) == number).ToList();
            if (labels.Count <= onPage.Count) continue;
            var missing = labels.Where(label => !onPage.Any(day => NormalizeName(day.DayName ?? "") == NormalizeName(label))).ToList();
            if (missing.Count != labels.Count - onPage.Count) continue;

            var neighbour = onPage.FirstOrDefault() ?? output.LastOrDefault(day => (day.SourcePage ?? 0) < number) ?? output[0];
            var added = missing.Select(label => (Label: label, Rows: RowsFor(label, page, labels.Count, labels.IndexOf(label))))
                .Where(item => item.Rows.Count > 0)
                .Select(item => new AiDay(page.Block ?? neighbour.Block, page.Phase ?? neighbour.Phase, page.Week ?? neighbour.WeekNumber,
                    page.Week is null || page.Week == neighbour.WeekNumber ? neighbour.PhaseWeek : 1, item.Label, false, null,
                    RecoverPrintedRows([], item.Rows, page, number, item.Label, false), number)).ToList();
            if (added.Count == 0) continue;

            // The page's days are put back in the order its labels print them.
            var sessions = onPage.Concat(added).OrderBy(day => labels.FindIndex(label => NormalizeName(label) == NormalizeName(day.DayName ?? ""))).ToList();
            var at = onPage.Count > 0 ? output.IndexOf(onPage[0]) : output.FindLastIndex(day => (day.SourcePage ?? 0) < number) + 1;
            output.RemoveAll(day => onPage.Contains(day));
            output.InsertRange(Math.Min(at, output.Count), sessions);
        }
        return output;
    }
}
