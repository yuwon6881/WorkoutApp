namespace Workout.Api.Services;

/// A read can name a movement the document never prints. It happens on long, highly repetitive
/// schedules, where a section drifts into plausible gym exercises instead of transcribing the rows
/// in front of it, and an invented name is indistinguishable from a real one downstream: it
/// becomes another slot to map, or — worse — matches the catalog and enters the program silently.
///
/// The pages a section was handed are the evidence. A name that appears nowhere in them is
/// reported against its own exercise, so deleting that exercise in review clears the notice. The
/// exercise is never dropped here: a faithful read lost to a spelling this check cannot see would
/// cost more than the invented names it saves.
internal static class ImportNameEvidence
{
    /// Reported against a name the section's own pages do not contain.
    public const string Code = "exercise_not_in_source";

    public static List<ImportReviewIssue> Unsupported(ImportDraft draft, IReadOnlyList<ImportPageText> pages)
    {
        var evidence = Key(string.Join(" ", pages.Select(page => page.Text)));
        // Pages with no text layer are a fact about those pages, not grounds to doubt a read.
        if (evidence.Length == 0) return [];

        var notices = new List<ImportReviewIssue>();
        foreach (var workout in draft.Workouts)
        {
            foreach (var exercise in workout.Exercises)
            {
                var name = Key(exercise.SourceName);
                if (name.Length == 0 || evidence.Contains(name, StringComparison.Ordinal)) continue;
                notices.Add(new ImportReviewIssue(Code,
                    $"\"{exercise.SourceName.Trim()}\" is not printed on the pages this section was read from. Check it against the PDF and delete it if the document does not list it.",
                    "warning", exercise.SourcePage ?? workout.SourcePage, workout.LineId, exercise.LineId));
            }
        }
        return notices;
    }

    /// Reported when a printed movement was read more times than the pages print it.
    public const string RepeatedCode = "exercise_repeated_beyond_source";

    /// The same drift that invents a name also repeats a real one: the Push/Pull/Legs read
    /// returned seven occurrences of a movement its document prints three times. The name is
    /// genuinely there, so this is reported rather than blocking — a document that prints one
    /// template and expects it repeated would otherwise be refused for following its own format.
    ///
    /// Counting is deliberately generous to the document: a name also printed in a substitution
    /// column, or contained in a longer movement's name, raises the printed count and so makes a
    /// report less likely, never more.
    public static List<ImportReviewIssue> OverCounted(ImportDraft draft, IReadOnlyList<ImportPageText> pages)
    {
        var evidence = Key(string.Join(" ", pages.Select(page => page.Text)));
        if (evidence.Length == 0) return [];

        var notices = new List<ImportReviewIssue>();
        var occurrences = draft.Workouts
            .SelectMany(workout => workout.Exercises.Select(exercise => (Workout: workout, Exercise: exercise)))
            .GroupBy(item => Key(item.Exercise.SourceName), StringComparer.Ordinal);
        foreach (var group in occurrences)
        {
            // A name the pages never print is already reported by `Unsupported`; saying it twice
            // would only crowd the review.
            var printed = Printed(evidence, group.Key);
            if (group.Key.Length == 0 || printed == 0 || group.Count() <= printed) continue;
            var last = group.Last();
            notices.Add(new ImportReviewIssue(RepeatedCode,
                $"\"{last.Exercise.SourceName.Trim()}\" is printed {printed} time{(printed == 1 ? "" : "s")} on these pages but was read {group.Count()} times. Check the extra days against the PDF.",
                "info", last.Exercise.SourcePage ?? last.Workout.SourcePage, last.Workout.LineId, last.Exercise.LineId));
        }
        return notices;
    }

    private static int Printed(string evidence, string name)
    {
        var count = 0;
        for (var at = evidence.IndexOf(name, StringComparison.Ordinal); at >= 0;
             at = evidence.IndexOf(name, at + name.Length, StringComparison.Ordinal)) count++;
        return count;
    }

    /// Both sides collapse to the same spelling, so casing, punctuation, line wrapping and the
    /// document's own abbreviations cannot hide a name that is genuinely printed.
    private static string Key(string? value)
        => CatalogMatching.Expand(CatalogService.Normalize(value ?? ""));
}
