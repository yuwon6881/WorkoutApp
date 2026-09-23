namespace Workout.Api.Services;

/// Some books print one complete, repeated weekly table per page without a WEEK heading. The
/// outline can mistake the block number for a week count and silently omit later pages. Only a
/// contiguous run of complete Day 1/2/3 pages across numbered blocks is strong enough evidence
/// to replace its proposed chunks with one page-local read per week.
internal static class ImportPageTemplateWeeks
{
    public static List<ImportChunk> Reconcile(List<ImportChunk> proposed, IReadOnlyList<ImportPageText> pages)
    {
        if (proposed.Count == 0) return proposed;
        var labels = ImportDayLabels.Read(pages);
        var candidates = pages.OrderBy(page => page.Page).Select(page =>
        {
            var lines = page.Text.ReplaceLineEndings("\n").Split('\n').Select(line => line.Trim()).ToList();
            var blocks = lines.Where(line => ImportStructureHeadings.TryBlock(line, out _))
                .Select(line => { ImportStructureHeadings.TryBlock(line, out var block); return block; })
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            labels.TryGetValue(page.Page, out var dayLabels);
            var complete = dayLabels is { Count: 3 }
                && dayLabels.Select(label => label.ToUpperInvariant()).SequenceEqual(["DAY 1", "DAY 2", "DAY 3"]);
            return new { page.Page, Complete = complete, Block = blocks.Count == 1 ? blocks[0] : null,
                HasWeekHeading = lines.Any(line => ImportStructureHeadings.TryWeek(line, out _)) };
        }).Where(item => item.Complete && item.Block is not null && !item.HasWeekHeading).ToList();
        if (candidates.Count < 4 || candidates.Count > 20
            || candidates.Select(item => item.Block).Distinct(StringComparer.OrdinalIgnoreCase).Count() < 2
            || candidates.Skip(1).Where((item, index) => item.Page != candidates[index].Page + 1).Any()
            || labels.Keys.Any(page => page < candidates[0].Page || page > candidates[^1].Page)
            || proposed.Any(chunk => chunk.PageTo < candidates[0].Page || chunk.PageFrom > candidates[^1].Page))
            return proposed;

        // Each numbered block occupies a single run; a later return to an earlier block would
        // make this ambiguous rather than an ordinary week sequence.
        var blockRuns = candidates.Select(item => item.Block!).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var observedRuns = candidates.Where((item, index) => index == 0
                || !string.Equals(item.Block, candidates[index - 1].Block, StringComparison.OrdinalIgnoreCase))
            .Select(item => item.Block!).ToList();
        if (!blockRuns.SequenceEqual(observedRuns, StringComparer.OrdinalIgnoreCase)) return proposed;

        return candidates.Select((item, index) => new ImportChunk(
            $"Block {item.Block}, week {index + 1}", $"Block {item.Block}", null,
            index + 1, index + 1, item.Page, item.Page, 3)).ToList();
    }
}
