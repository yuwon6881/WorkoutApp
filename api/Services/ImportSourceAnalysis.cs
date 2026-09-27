namespace Workout.Api.Services;

using System.Text.RegularExpressions;

/// Pass-local, immutable source indexes shared by extraction, local table reads, verification, and
/// final assembly. It contains only text already submitted by this device and is cleared with the
/// transient import work state.
internal sealed record ImportSourceAnalysis(
    IReadOnlyList<ImportPageText> Pages,
    ImportOutlineEvidence.Evidence Outline,
    ImportPrintedSchedule? Schedule,
    IReadOnlyDictionary<int, int> PrintedWeeks,
    IReadOnlyDictionary<int, (int Week, string Version)> WeekVersions,
    IReadOnlyDictionary<int, List<string>> DayLabels,
    ImportTableEvidence.SourceRead Tables,
    bool PreserveTrailingRestDays)
{
    private static readonly Regex ProgramChoice = new(
        @"\b(?:choose|select|pick)\b[^\r\n]{0,80}\b(?:program|routine|split)\b|\b(?:program|routine|split)\b[^\r\n]{0,80}\b(?:option|version|either|choose)\b|\b(?:program|routine|split)\b[^\r\n]{0,80}\b(?:or|versus|vs\.?)\b[^\r\n]{0,80}\b(?:program|routine|split)\b|\b(?:run|follow|use)\b[^\r\n]{0,40}\b(?:either|one of)\b[^\r\n]{0,40}\b(?:program|routine|split)\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static ImportSourceAnalysis Create(IReadOnlyList<ImportPageText> pages)
    {
        var ordered = pages.OrderBy(page => page.Page).ToArray();
        var schedule = ImportPrintedSchedule.Read(ordered);
        return new ImportSourceAnalysis(ordered, ImportOutlineEvidence.Read(ordered), schedule,
            schedule?.WeekOfPage() ?? new Dictionary<int, int>(), ImportWeekVariants.PageVersions(ordered),
            ImportDayLabels.Read(ordered), ImportTableEvidence.Analyze(ImportSourceText.AllPages(ordered)),
            ImportLongWeeks.IsTenDayCycleSource(ordered) || ImportLongWeeks.HasSourceLongWeek(ordered));
    }

    public IReadOnlyList<ImportPageText> For(ImportChunk chunk)
        => Pages.Where(page => page.Page >= chunk.PageFrom && page.Page <= chunk.PageTo).ToArray();

    public string Slice(ImportChunk chunk, IReadOnlySet<int>? selectedPages = null)
        => selectedPages is null
            ? ImportSourceText.Slice(Pages, chunk.PageFrom, chunk.PageTo)
            : ImportSourceText.SlicePages(Pages, chunk.PageFrom, chunk.PageTo, selectedPages);

    public AiOutline? ReadLocalOutline()
    {
        if (Schedule is null || ProgramChoice.IsMatch(string.Join("\n", Pages.Select(page => page.Text)))) return null;
        var title = ImportProgramTitle.Grounded(null, Pages);
        if (string.IsNullOrWhiteSpace(title)) return null;
        var trainingPages = Schedule.Days.Where(day => !day.IsRestDay).Select(day => day.Page).ToHashSet();
        if (trainingPages.Count == 0 || ImportTableEvidence.HasRowsOutside(Tables, trainingPages)) return null;
        var chunks = Schedule.Chunks();
        if (chunks.Count == 0) return null;
        var outline = chunks.Select(chunk => new AiOutlineChunk(chunk.Label, chunk.Block, chunk.Phase,
            chunk.WeekFrom, chunk.WeekTo, chunk.PageFrom, chunk.PageTo, chunk.DayCount)).ToList();
        return new AiOutline(title, outline);
    }
}
