namespace Workout.Api.Services;

/// An outline can mistake two versions of one printed week for two whole programs.
/// Recover the shared schedule before asking for the week choice after extraction.
internal static class ImportAlternativeWeekScope
{
    public const string NoticeCode = "alternative_is_week_version";

    public static List<AiOutlineChunk>? Recover(List<AiAlternative> alternatives,
        IReadOnlyList<ImportPageText> pages, ImportSourceAnalysis? analysis)
    {
        if (alternatives.Count < 2) return null;
        var versions = analysis?.WeekVersions ?? ImportWeekVariants.PageVersions(pages);
        if (versions.Count == 0) return null;
        var schedule = analysis?.Schedule ?? ImportPrintedSchedule.Read(pages);
        var chunks = schedule?.Chunks().Select(chunk => new AiOutlineChunk(chunk.Label, chunk.Block,
            chunk.Phase, chunk.WeekFrom, chunk.WeekTo, chunk.PageFrom, chunk.PageTo, chunk.DayCount)).ToList()
            ?? ImportNumberedTableOutline.Read(pages, analysis);
        if (chunks is null) return null;
        var trainingPages = chunks.SelectMany(chunk => Enumerable.Range(chunk.PageFrom,
            chunk.PageTo - chunk.PageFrom + 1)).ToHashSet();
        var scopes = new List<(int Week, string Version)>();
        foreach (var alternative in alternatives)
        {
            var covered = trainingPages.Where(page => alternative.Chunks.Any(chunk =>
                page >= chunk.PageFrom && page <= chunk.PageTo)).ToList();
            // Whole-program alternatives also cover shared weeks; leave those choices intact.
            if (covered.Count == 0 || covered.Any(page => !versions.ContainsKey(page))) return null;
            var labels = covered.Select(page => versions[page]).Distinct().ToList();
            if (labels.Count != 1) return null;
            scopes.Add(labels[0]);
        }
        if (scopes.Select(scope => scope.Week).Distinct().Count() != 1
            || scopes.Select(scope => scope.Version).Distinct().Count() < 2
            || !trainingPages.Any(page => !versions.ContainsKey(page))) return null;
        return chunks;
    }
}
