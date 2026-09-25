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
        if (string.IsNullOrWhiteSpace(title)) return running;
        var key = CatalogService.Normalize(title);
        var footer = CatalogService.Normalize(running);
        // A fuller or shorter form of the footer's own name is the same program.
        if (key.Length > 0 && (key.Contains(footer, StringComparison.Ordinal) || footer.Contains(key, StringComparison.Ordinal)))
            return title;
        // A line printed on as many pages as the footer is a table header ("Tracking Load and Reps"), not a name.
        if (pages.Count(page => page.Text.Split('\n').Any(line => CatalogService.Normalize(line) == key)) >= Threshold(pages))
            return running;
        return PrintedAsHeading(key, pages) ? title : running;
    }

    private static int Threshold(IReadOnlyList<ImportPageText> pages)
        => Math.Max(4, pages.Count(page => !string.IsNullOrWhiteSpace(page.Text)) * 2 / 5);

    /// The line a document prints at the top or bottom of most of its pages, less the page number.
    /// Of lines printed as often, one printed beside a page number is the footer: BTS Beginner heads
    /// its tables "Tracking Load and Reps" on as many pages as it prints its footer.
    internal static string? RunningTitle(IReadOnlyList<ImportPageText> pages)
    {
        var withText = pages.Where(page => !string.IsNullOrWhiteSpace(page.Text)).ToList();
        if (withText.Count < 4) return null;
        var counts = new Dictionary<string, (int Pages, int Numbered, string Text)>(StringComparer.Ordinal);
        foreach (var page in withText)
        {
            var lines = page.Text.Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0).ToList();
            var edges = lines.Take(EdgeLines).Concat(lines.TakeLast(EdgeLines));
            foreach (var (candidate, numbered) in edges.Where(line => !NotATitle.IsMatch(line))
                .Select(line => (Text: Clean(line), Numbered: PageNumber.IsMatch(line))).Where(item => IsTitleLike(item.Text))
                .DistinctBy(item => item.Text, StringComparer.Ordinal))
            {
                var key = CatalogService.Normalize(candidate);
                var number = numbered ? 1 : 0;
                counts[key] = counts.TryGetValue(key, out var seen) ? (seen.Pages + 1, seen.Numbered + number, seen.Text) : (1, number, candidate);
            }
        }
        var threshold = Threshold(withText);
        var best = counts.Values.Where(entry => entry.Pages >= threshold)
            .OrderByDescending(entry => entry.Numbered * 2 >= entry.Pages).ThenByDescending(entry => entry.Pages).FirstOrDefault();
        return best.Text;
    }

    /// A footer carries its page number on one side ("The Pure Bodybuilding Program | 1"). Only that
    /// one number goes: "Phase 2 | 9" keeps its 2.
    private static string Clean(string line) => PageNumber.Replace(line, "").Trim();

    private static bool IsTitleLike(string line)
        => line.Length is >= 6 and <= 80 && line.Count(char.IsLetter) >= 5 && !NotATitle.IsMatch(line)
           // A letter-spaced banner ("P OW E R B U I L D I N G") is artwork, not a name to show.
           && line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Count(word => word.Length == 1 && char.IsLetter(word[0])) < 3;

    /// Printed as a heading or cover line, not lifted from a sentence: the Full Body edition's notes
    /// say "this Full Body version of the program", and "Full Body Version" became its name.
    private static bool PrintedAsHeading(string key, IReadOnlyList<ImportPageText> pages)
        => key.Length > 0 && pages.Any(page => page.Text.Split('\n').Select(CatalogService.Normalize)
            .Any(line => line.Contains(key, StringComparison.Ordinal) && line.Length <= key.Length * 2 + 10));
}
