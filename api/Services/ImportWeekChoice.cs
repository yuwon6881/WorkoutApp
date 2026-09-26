using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// A program that prints one week in lettered versions and says to run only one ("CHOOSE EITHER
/// WEEK 10A OR WEEK 10B. DO NOT RUN BOTH") is not imported with both. Once the program is read,
/// each version is offered as a choice, the way a PDF holding several programs is, and only the
/// chosen version's days are kept, in the week the document numbers.
internal static class ImportWeekChoice
{
    public const string ChosenCode = "week_version_chosen";

    private sealed record Group(int Week, List<string> Letters);

    /// The versions a lifter chooses between, or none when the document prints no lettered week.
    public static List<ImportAlternative> Offer(ImportDraft draft, IReadOnlyList<ImportPageText> pages)
    {
        var versions = ImportWeekVariants.PageVersions(pages);
        if (versions.Count == 0) return [];
        var labelled = Label(draft.Workouts, versions);
        var groups = labelled.Where(item => item.Version is not null)
            .GroupBy(item => item.Version!.Value.Week)
            .Select(group => new Group(group.Key, [.. group.Select(item => item.Version!.Value.Letter).Distinct(StringComparer.OrdinalIgnoreCase)]))
            .Where(group => group.Letters.Count > 1).ToList();
        if (groups.Count == 0) return [];

        var letters = groups.SelectMany(group => group.Letters).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var chosenWeeks = groups.Select(group => group.Week).ToHashSet();
        var totalWeeks = draft.Workouts.Select(day => day.Week).Distinct().Count()
            - groups.Sum(group => group.Letters.Count - 1);
        return letters.Select(letter =>
        {
            var days = labelled.Where(item => item.Version is { } version && chosenWeeks.Contains(version.Week)
                && string.Equals(version.Letter, letter, StringComparison.OrdinalIgnoreCase)).Select(item => item.Day).ToList();
            var training = days.Count(day => !day.IsRestDay);
            var names = groups.Where(group => group.Letters.Contains(letter, StringComparer.OrdinalIgnoreCase))
                .Select(group => $"{group.Week}{letter}").ToList();
            var name = names.Count == 1 ? $"Week {names[0]}" : $"Weeks {string.Join(", ", names)}";
            return new ImportAlternative($"week-{letter.ToLowerInvariant()}", name, 0, training,
                WeekCount: totalWeeks, SessionsPerWeek: training / Math.Max(1, names.Count),
                Kind: ImportAlternativeKinds.Week, Description: Guidance(pages, groups[0].Week, letter, letters),
                DayLineIds: [.. days.Select(day => day.LineId)]);
        }).ToList();
    }

    /// The draft with only the chosen version's days, its weeks numbered as the document numbers them.
    public static ImportDraft Apply(ImportDraft draft, ImportAlternative chosen, IReadOnlyList<ImportAlternative> offered)
    {
        var dropped = offered.Where(alternative => alternative.Id != chosen.Id)
            .SelectMany(alternative => alternative.DayLineIds ?? []).ToHashSet();
        var kept = draft.Workouts.Where(day => !dropped.Contains(day.LineId)).ToList();
        // The versions were read as consecutive weeks; only the weeks the others held close up.
        var emptied = draft.Workouts.Select(day => day.Week).Except(kept.Select(day => day.Week)).ToList();
        return draft with
        {
            Workouts = [.. kept.Select(day =>
            {
                var week = day.Week - emptied.Count(empty => empty < day.Week);
                var shift = week - day.Week;
                return shift == 0 ? day : day with { Week = week, PhaseWeek = day.PhaseWeek > 0 ? Math.Max(1, day.PhaseWeek + shift) : day.PhaseWeek };
            })]
        };
    }

    public static ImportReviewIssue ChosenNotice(ImportAlternative chosen, IReadOnlyList<ImportAlternative> offered)
        => new(ChosenCode,
            $"The document asks for one of {string.Join(" or ", offered.Select(alternative => alternative.Name))}; {chosen.Name} was imported.",
            "info");

    /// Which lettered version each day belongs to. A day cites its page; a day that cites none (a
    /// rest day read without one) belongs with the day printed before it.
    private static List<(DraftWorkout Day, (int Week, string Letter)? Version)> Label(
        IReadOnlyList<DraftWorkout> workouts, Dictionary<int, (int Week, string Version)> versions)
    {
        var labelled = new List<(DraftWorkout Day, (int Week, string Letter)? Version)>();
        (int Week, string Letter)? current = null;
        foreach (var day in workouts)
        {
            var page = day.SourcePage ?? day.Exercises.Select(exercise => exercise.SourcePage).FirstOrDefault(value => value is not null);
            if (page is { } number && versions.TryGetValue(number, out var printed)) current = (printed.Week, printed.Version);
            else if (page is not null) current = null;
            labelled.Add((day, current));
        }
        return labelled;
    }

    /// The document's own advice on when to run a version ("Run Week 10A only if you have
    /// competitive powerlifting goals"): a short line that names this version and no other.
    private static string? Guidance(IReadOnlyList<ImportPageText> pages, int week, string letter, List<string> letters)
    {
        var mine = new Regex($@"\bWEEK\s*{week}\s*{letter}\b", RegexOptions.IgnoreCase);
        var others = letters.Where(other => !string.Equals(other, letter, StringComparison.OrdinalIgnoreCase))
            .Select(other => new Regex($@"\b(?:WEEK\s*)?{week}\s*{other}\b", RegexOptions.IgnoreCase)).ToList();
        var line = pages.SelectMany(page => (page.Text ?? "").ReplaceLineEndings("\n").Split('\n'))
            .Select(text => Regex.Replace(text, @"^[\s•·*\-–]+", "").Trim())
            .FirstOrDefault(text => text.Length is > 16 and <= 160 && mine.IsMatch(text)
                && !others.Any(other => other.IsMatch(text)) && text.Contains(' ') && !text.Contains('|')
                && !Regex.IsMatch(text, @"^WEEK\s*\d+\s*[A-Z]$", RegexOptions.IgnoreCase));
        return line is null ? null : SentenceCase(line);
    }

    /// A line printed in capitals reads as a sentence, keeping week labels such as "10A" whole.
    private static string SentenceCase(string text)
    {
        if (text.Any(char.IsLower)) return text;
        var lower = text.ToLowerInvariant();
        lower = Regex.Replace(lower, @"\b(\d+)([a-z])\b", match => match.Groups[1].Value + match.Groups[2].Value.ToUpperInvariant());
        return char.ToUpperInvariant(lower[0]) + lower[1..];
    }
}
