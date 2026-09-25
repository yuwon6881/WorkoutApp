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
        // A day's own title names a session, not the program: Pure Bodybuilding Full Body came back as
        // "Full Body", the stem of every "Full Body #3" it prints.
        if (ImportDayLabels.Read(pages).Values.SelectMany(labels => labels)
            .Any(label => CatalogService.Normalize(label).StartsWith(key, StringComparison.Ordinal)))
            return running;
        return PrintedAsHeading(key, pages) ? title : running;
    }

    private static int Threshold(IReadOnlyList<ImportPageText> pages)
        => Math.Max(4, pages.Count(page => !string.IsNullOrWhiteSpace(page.Text)) * 2 / 5);

    /// The line a document prints at the top or bottom of most of its pages, less the page number.
    /// Of lines printed as often, one printed beside a number that follows the page is the footer:
    /// BTS Beginner heads its tables "Tracking Load and Reps" on as many pages as it prints its
    /// footer, and Chest Hypertrophy repeats "WEEKLY SET VOLUME | 21" with a weekly tally.
    internal static string? RunningTitle(IReadOnlyList<ImportPageText> pages)
    {
        var withText = pages.Where(page => !string.IsNullOrWhiteSpace(page.Text)).ToList();
        if (withText.Count < 4) return null;
        var counts = new Dictionary<string, (int Pages, List<int> Offsets, string Text)>(StringComparer.Ordinal);
        foreach (var page in withText)
        {
            var lines = page.Text.Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0).ToList();
            var edges = lines.Take(EdgeLines).Concat(lines.TakeLast(EdgeLines));
            // The page number goes first, so "NAME | Program | 6" is judged as the two cells it names.
            foreach (var (candidate, number) in edges.Select(line => (Text: Clean(line), Number: PageNumberOf(line)))
                .Where(item => IsTitleLike(item.Text) && item.Text.Split('|').All(cell => cell.Any(char.IsLetter)))
                .DistinctBy(item => item.Text, StringComparer.Ordinal))
            {
                var key = CatalogService.Normalize(candidate);
                if (!counts.TryGetValue(key, out var seen)) counts[key] = seen = (0, [], RepairCase(candidate.Replace(" | ", " - ")));
                if (number is { } value) seen.Offsets.Add(value - page.Page);
                counts[key] = (seen.Pages + 1, seen.Offsets, seen.Text);
            }
        }
        var threshold = Threshold(withText);
        var best = counts.Values.Where(entry => entry.Pages >= threshold)
            .OrderByDescending(entry => FollowsThePage(entry.Offsets) * 2 >= entry.Pages)
            .ThenByDescending(entry => entry.Offsets.Count * 2 >= entry.Pages).ThenByDescending(entry => entry.Pages).FirstOrDefault();
        return best.Text;
    }

    /// How many of a line's numbers keep one distance from the PDF page, as a page number does.
    private static int FollowsThePage(List<int> offsets)
        => offsets.Count == 0 ? 0 : offsets.GroupBy(offset => offset).Max(group => group.Count());

    /// Small caps read back as ragged case ("JEFF nIPPARd’S"): a word with a capital after a small
    /// letter is set in title case, and every other word is left as printed.
    private static string RepairCase(string title)
        => Regex.Replace(title, @"[\p{L}’']+", match => Regex.IsMatch(match.Value, @"\p{Ll}\p{Lu}")
            ? char.ToUpperInvariant(match.Value[0]) + match.Value[1..].ToLowerInvariant() : match.Value);

    private static int? PageNumberOf(string line)
        => PageNumber.Match(line) is { Success: true } match && int.TryParse(match.Value.Trim(" |·-–".ToCharArray()), out var number) ? number : null;

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
        => key.Length > 0 && pages.Any(page => page.Text.Split('\n')
            // A day label or a table row is not where a book prints its name.
            .Where(line => !line.Contains('|') && !ImportStructureHeadings.TryDayLabel(line, out _))
            .Select(CatalogService.Normalize)
            .Any(line => line.Contains(key, StringComparison.Ordinal) && line.Length <= key.Length * 2 + 10));
}
