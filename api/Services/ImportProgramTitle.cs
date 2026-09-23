using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// The outline names the program, and a book that keeps referring readers to a companion title
/// can lead it astray: The Pure Bodybuilding Program came back as "Hypertrophy Handbook Program"
/// because its notes say "see The Hypertrophy Handbook" on page after page. The program's own
/// name is printed in the running footer of every schedule page, so a title the document never
/// prints gives way to the one it repeats. A title that is printed is always kept.
internal static class ImportProgramTitle
{
    private static readonly Regex PageNumber = new(@"^(?:\d{1,3}\s*[|·\-–]?\s*)|(?:\s*[|·\-–]?\s*\d{1,3})$", RegexOptions.Compiled);
    private static readonly Regex NotATitle = new(@"^(?:WEEK|BLOCK|DAY LABEL|DAY \d|EXERCISE)\b|\|.*\||[.!?:]$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private const int EdgeLines = 3;

    public static string? Grounded(string? title, IReadOnlyList<ImportPageText> pages)
    {
        var running = RunningTitle(pages);
        if (running is null) return title;
        if (!string.IsNullOrWhiteSpace(title) && Printed(title, pages)) return title;
        return running;
    }

    /// The line a document prints at the top or bottom of most of its pages, less the page number.
    internal static string? RunningTitle(IReadOnlyList<ImportPageText> pages)
    {
        var withText = pages.Where(page => !string.IsNullOrWhiteSpace(page.Text)).ToList();
        if (withText.Count < 4) return null;
        var counts = new Dictionary<string, (int Pages, string Text)>(StringComparer.Ordinal);
        foreach (var page in withText)
        {
            var lines = page.Text.Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0).ToList();
            var edges = lines.Take(EdgeLines).Concat(lines.TakeLast(EdgeLines));
            foreach (var candidate in edges.Where(line => !NotATitle.IsMatch(line)).Select(Clean).Where(IsTitleLike).Distinct(StringComparer.Ordinal))
            {
                var key = CatalogService.Normalize(candidate);
                counts[key] = counts.TryGetValue(key, out var seen) ? (seen.Pages + 1, seen.Text) : (1, candidate);
            }
        }
        var best = counts.Values.OrderByDescending(entry => entry.Pages).FirstOrDefault();
        return best.Pages >= Math.Max(4, withText.Count * 2 / 5) ? best.Text : null;
    }

    /// A footer carries its page number on one side ("The Pure Bodybuilding Program | 1"). Only that
    /// one number goes: "Phase 2 | 9" keeps its 2.
    private static string Clean(string line) => PageNumber.Replace(line, "").Trim();

    private static bool IsTitleLike(string line)
        => line.Length is >= 6 and <= 80 && line.Count(char.IsLetter) >= 5 && !NotATitle.IsMatch(line)
           // A letter-spaced banner ("P OW E R B U I L D I N G") is artwork, not a name to show.
           && line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Count(word => word.Length == 1 && char.IsLetter(word[0])) < 3;

    private static bool Printed(string title, IReadOnlyList<ImportPageText> pages)
    {
        var key = CatalogService.Normalize(title);
        return key.Length > 0 && pages.Any(page => CatalogService.Normalize(page.Text).Contains(key, StringComparison.Ordinal));
    }
}
