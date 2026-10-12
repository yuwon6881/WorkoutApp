namespace Workout.Api.Services;

/// A numbered table run can locate the whole program even when optional pages or an appendix
/// prevent complete slot discovery. Only pages within the run and explicitly scheduled extras
/// belong to this fallback; inherited week context cannot turn appendix examples into workouts.
internal static class ImportNumberedTableOutline
{
    public static List<AiOutlineChunk>? Read(IReadOnlyList<ImportPageText> pages, ImportSourceAnalysis? analysis)
    {
        var tables = analysis?.Tables ?? ImportTableEvidence.Analyze(ImportSourceText.AllPages(pages));
        var numbered = pages.Where(page => tables.Pages.TryGetValue(page.Page, out var table)
            && table.Rows.Any(row => row.FullHeader && !row.Prose)
            && page.Text.ReplaceLineEndings("\n").Split('\n').Any(line =>
                ImportStructureHeadings.TryWeek(ImportStructureHeadings.LeadingSegment(line.Trim()), out _)))
            .OrderBy(page => page.Page).ToList();
        if (numbered.Count < 2) return null;
        var first = numbered[0].Page;
        var last = numbered[^1].Page;
        var weeks = numbered.Select(page => tables.Pages[page.Page].Week).ToList();
        if (weeks.Any(week => week is null) || weeks[0] != 1
            || weeks.Zip(weeks.Skip(1)).Any(pair => pair.Second < pair.First || pair.Second > pair.First + 1)) return null;

        var chunks = new List<AiOutlineChunk>();
        foreach (var page in pages.OrderBy(page => page.Page))
        {
            if (!tables.Pages.TryGetValue(page.Page, out var table)
                || !table.Rows.Any(row => row.FullHeader && !row.Prose)) continue;
            var optional = ImportOptionalScheduleDays.ScheduledWeeks(page.Text);
            if ((page.Page < first || page.Page > last) && optional.Count == 0) continue;
            // The section is read in its source context; final optional-day reconciliation
            // copies it into the explicitly listed weeks once their block contexts exist.
            var week = table.Week ?? optional.FirstOrDefault();
            if (week < 1) return null;
            var dayCount = Math.Max(1, table.Rows.Select(row => row.Table).Distinct().Count());
            var rests = page.Text.ReplaceLineEndings("\n").Split('\n')
                .Count(line => ImportLongWeeks.RestBand.IsMatch(line.Trim()));
            chunks.Add(new AiOutlineChunk($"Week {week}", table.Block, table.Phase, week, week,
                page.Page, page.Page, dayCount + rests));
        }
        return chunks.Count > 0 ? chunks : null;
    }
}
