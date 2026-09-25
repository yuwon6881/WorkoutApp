using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Applies printed day titles after extraction and supplies a stable name only where the source
/// had no title that could be paired unambiguously.
internal static class ImportDayLabels
{
    /// How many renamed days are worth a note of their own before the review is better served by
    /// a single count.
    private const int MaxAnchoredRenames = 3;

    internal sealed record Result(ImportDraft Draft, List<ImportReviewIssue> Notices);

    public static Dictionary<int, List<string>> Read(IReadOnlyList<ImportPageText> pages)
    {
        var labels = new Dictionary<int, List<string>>();
        foreach (var page in pages.OrderBy(page => page.Page))
        {
            var lines = (page.Text ?? "").ReplaceLineEndings("\n").Split('\n');
            for (var i = 0; i < lines.Length; i++)
            {
                var raw = lines[i];
                if (!ImportStructureHeadings.TryDayLabel(raw, out var label)) continue;
                if (IsRestSession(lines, i, label)) continue;
                if (!labels.TryGetValue(page.Page, out var pageLabels)) labels[page.Page] = pageLabels = [];
                pageLabels.Add(label.Replace('|', '/'));
            }
        }
        return labels;
    }

    private static bool IsRestSession(string[] lines, int index, string label)
    {
        if (label.Equals("REST", StringComparison.OrdinalIgnoreCase) || label.StartsWith("REST ", StringComparison.OrdinalIgnoreCase))
            return true;
        var nonHeadersChecked = 0;
        for (var j = index + 1; j < lines.Length && nonHeadersChecked < 3; j++)
        {
            var line = lines[j].Trim();
            if (string.IsNullOrEmpty(line)) continue;
            if (ImportStructureHeadings.TryDayLabel(line, out _)) break;
            if (Regex.IsMatch(line, @"^(?:REST\s*\||N/A\b.*NO PHYSICAL ACTIVITY|TOTAL SET VOLUME:\s*0\b)", RegexOptions.IgnoreCase))
                return true;
            nonHeadersChecked++;
        }
        return false;
    }

    public static Result Apply(ImportDraft draft, IReadOnlyList<ImportPageText> pages)
    {
        var labelsByPage = Read(pages);
        if (labelsByPage.Count == 0) return new Result(draft, []);

        var workouts = draft.Workouts.ToList();
        var notices = new List<ImportReviewIssue>();
        var renamed = new List<(int Page, Guid LineId, string Label)>();
        foreach (var (page, labels) in labelsByPage)
        {
            var dayIndexes = workouts.Select((workout, index) => (Workout: workout, Index: index, Page: SourcePage(workout)))
                .Where(item => !item.Workout.IsRestDay && item.Page == page)
                .Select(item => item.Index).ToList();
            if (dayIndexes.Count != labels.Count)
            {
                notices.Add(new ImportReviewIssue("day_label_ambiguous",
                    $"PDF page {page} has {labels.Count} printed day title{(labels.Count == 1 ? "" : "s")} for {dayIndexes.Count} training day{(dayIndexes.Count == 1 ? "" : "s")}; no title was applied.",
                    "info", page));
                continue;
            }

            for (var index = 0; index < labels.Count; index++)
            {
                var workoutIndex = dayIndexes[index];
                var workout = workouts[workoutIndex];
                var label = ImportNormalization.Text(TidyLabel(labels[index]), 120);
                if (label is null) continue;
                if (!string.Equals(workout.Name.Trim(), label, StringComparison.Ordinal))
                    renamed.Add((page, workout.LineId, label));
                workouts[workoutIndex] = workout with { Name = label };
            }
        }

        notices.AddRange(RenameNotices(renamed));
        return new Result(draft with { Workouts = workouts }, notices);
    }

    /// A printed title is where a day's name is expected to come from, so reporting it for every
    /// day of a twelve-week program fills the review with a note nobody can act on and crowds out
    /// the ones that matter. A handful stays anchored to its own day; more than that is counted.
    private static IEnumerable<ImportReviewIssue> RenameNotices(List<(int Page, Guid LineId, string Label)> renamed)
    {
        if (renamed.Count == 0) return [];
        if (renamed.Count <= MaxAnchoredRenames)
            return renamed.Select(item => new ImportReviewIssue("day_name_from_source",
                $"The printed day title '{item.Label}' was used for this day.", "info", item.Page, item.LineId));
        return [new ImportReviewIssue("day_name_from_source",
            $"{renamed.Count} days were named from the titles printed in the PDF.", "info", renamed[0].Page)];
    }

    public static Result FillMissing(ImportDraft draft)
    {
        var countsByWeek = new Dictionary<int, int>();
        var workouts = new List<DraftWorkout>(draft.Workouts.Count);
        var filled = 0;
        foreach (var workout in draft.Workouts)
        {
            if (workout.IsRestDay || !string.IsNullOrWhiteSpace(workout.Name))
            {
                workouts.Add(workout);
                continue;
            }

            countsByWeek.TryGetValue(workout.Week, out var count);
            count++;
            countsByWeek[workout.Week] = count;
            workouts.Add(workout with { Name = $"Week {workout.Week} day {count}" });
            filled++;
        }

        var notices = filled == 0 ? [] : new List<ImportReviewIssue>
        {
            new("day_name_unlabelled", $"{filled} training day{(filled == 1 ? " had" : "s had")} no printed title and received a week-based name.", "info")
        };
        return new Result(draft with { Workouts = workouts }, notices);
    }

    public static string TidyLabel(string value)
    {
        var clean = Regex.Replace(value.Trim(), @"\s+", " ");
        return Regex.Replace(clean, @"[\p{L}\p{M}]+", match =>
        {
            var word = match.Value;
            var allUpper = word.ToUpperInvariant() == word;
            var allLower = word.ToLowerInvariant() == word;
            var upperPrefix = Regex.IsMatch(word, @"^[\p{Lu}]{2,}[\p{Ll}]+$");
            if (!allUpper && !allLower && !upperPrefix) return word;
            var title = word.ToLowerInvariant();
            return char.ToUpperInvariant(title[0]) + title[1..];
        });
    }

    private static int? SourcePage(DraftWorkout workout)
        => workout.SourcePage ?? UniqueSourcePage(workout.Exercises);

    private static int? UniqueSourcePage(List<DraftExercise> exercises)
    {
        var pages = exercises.SelectMany(exercise => new int?[] { exercise.SourcePage }
                .Concat(exercise.Sets.Select(set => set.SourcePage)))
            .Where(page => page.HasValue).Select(page => page.GetValueOrDefault()).Distinct().Take(2).ToList();
        return pages.Count == 1 ? pages[0] : null;
    }
}
