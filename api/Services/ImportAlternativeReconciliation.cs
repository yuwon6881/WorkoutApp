using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Reconciles claimed alternative program versions against printed schedule pages in the PDF.
/// Named versions are claims; printed pages are the evidence.
internal static class ImportAlternativeReconciliation
{
    internal sealed record Outcome(
        List<AiAlternative> Alternatives,
        List<AiOutlineChunk> Chunks,
        List<ImportReviewIssue> Notices);

    public static Outcome Reconcile(AiOutline outline, IReadOnlyList<ImportPageText> pages)
    {
        var chunks = outline.Chunks ?? [];
        var alternatives = outline.Alternatives ?? [];
        var schedulePages = new HashSet<int>(pages.Where(IsSchedulePage).Select(p => p.Page));

        var dropped = new List<AiAlternative>();
        var survivors = new List<AiAlternative>();
        foreach (var alternative in alternatives)
        {
            if (alternative.Chunks is null or { Count: 0 } || !alternative.Chunks.Any(chunk => IsChunkBacked(chunk, schedulePages)))
            {
                dropped.Add(alternative);
            }
            else
            {
                survivors.Add(alternative);
            }
        }

        var notices = new List<ImportReviewIssue>();
        if (dropped.Count > 0)
        {
            var names = string.Join(", ", dropped.Select(alt =>
                ImportNormalization.Label(string.IsNullOrWhiteSpace(alt.Name) ? alt.Id : alt.Name, 80, "unnamed")));
            notices.Add(new ImportReviewIssue(
                "alternative_not_in_document",
                $"This PDF describes another version of the program ({names}) but does not contain its schedule, so only the schedule printed in this file was imported.",
                "info", null));
        }

        var chunksBackedPages = BackedPages(chunks, schedulePages);
        var hasChunks = chunks.Count > 0;

        if (survivors.Count == 0)
        {
            if (hasChunks)
            {
                return new Outcome([], chunks, notices);
            }
            throw new DomainException(
                "This PDF names program versions but does not contain their schedules. Import the PDF that holds the schedule you want.",
                422);
        }

        if (survivors.Count == 1)
        {
            var survivor = survivors[0];
            var survivorBackedPages = BackedPages(survivor.Chunks, schedulePages);

            if (hasChunks)
            {
                if (survivorBackedPages.IsSubsetOf(chunksBackedPages))
                {
                    notices.Add(new ImportReviewIssue(
                        "alternative_without_own_pages",
                        "The outline named a program version that covers the same pages as the schedule in this file, so the printed schedule was imported without asking you to choose.",
                        "info", null));
                    return new Outcome([], chunks, notices);
                }

                notices.Add(new ImportReviewIssue(
                    "outline_chunks_ignored",
                    "The outline also listed pages outside the program version used here; those pages were not extracted.",
                    "info", null));
                return new Outcome([survivor], [], notices);
            }

            return new Outcome([survivor], [], notices);
        }

        // 2 or more survivors: alternatives win, drop unscoped chunk list.
        if (hasChunks)
        {
            notices.Add(new ImportReviewIssue(
                "outline_chunks_ignored",
                "The outline also listed pages outside the program version used here; those pages were not extracted.",
                "info", null));
        }
        return new Outcome(survivors, [], notices);
    }

    public static bool IsSchedulePage(ImportPageText page)
    {
        var pipeLines = 0;
        using var reader = new StringReader(page.Text ?? "");
        while (reader.ReadLine() is { } rawLine)
        {
            var line = rawLine.Trim();
            if (line.Contains('|'))
            {
                pipeLines++;
                if (pipeLines >= 2) return true;
            }
            if (ImportStructureHeadings.TryWeek(line, out _) || ImportStructureHeadings.TryDayLabel(line, out _))
            {
                return true;
            }
        }
        return false;
    }

    private static bool IsChunkBacked(AiOutlineChunk chunk, HashSet<int> schedulePages)
    {
        for (var page = chunk.PageFrom; page <= chunk.PageTo; page++)
        {
            if (schedulePages.Contains(page)) return true;
        }
        return false;
    }

    private static HashSet<int> BackedPages(IEnumerable<AiOutlineChunk>? chunks, HashSet<int> schedulePages)
    {
        var pages = new HashSet<int>();
        if (chunks is null) return pages;
        foreach (var chunk in chunks)
        {
            for (var page = chunk.PageFrom; page <= chunk.PageTo; page++)
            {
                if (schedulePages.Contains(page))
                {
                    pages.Add(page);
                }
            }
        }
        return pages;
    }
}
