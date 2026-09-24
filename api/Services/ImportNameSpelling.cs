namespace Workout.Api.Services;

/// One written movement keeps one spelling across the whole import. Each section is read on its
/// own, and a read can retype a printed name in title case ("Dumbbell Bench-Braced Wrist Curl" in
/// week 4 of a book that prints "DUMBBELL BENCH-BRACED WRIST CURL" every week), so the same slot
/// showed two names in review.
///
/// Spellings that differ only in case, spacing or punctuation are the same movement. The one the
/// pages print verbatim wins, then the most frequent. Names that differ in words are left alone.
internal static class ImportNameSpelling
{
    public static ImportDraft Standardize(ImportDraft draft, IReadOnlyList<ImportPageText> pages)
    {
        draft = WithRepairedCase(draft);
        var text = string.Join("\n", pages.Select(page => page.Text));
        var spelling = draft.Workouts
            .SelectMany(workout => workout.Exercises.Select(exercise => exercise.SourceName.Trim()))
            .Where(name => name.Length > 0)
            .GroupBy(CatalogService.Normalize)
            .Where(group => group.Key.Length > 0 && group.Distinct(StringComparer.Ordinal).Skip(1).Any())
            .ToDictionary(group => group.Key, group => group
                .GroupBy(name => name, StringComparer.Ordinal)
                .OrderByDescending(variant => text.Contains(variant.Key, StringComparison.Ordinal))
                .ThenByDescending(variant => variant.Count())
                .ThenBy(variant => variant.Key, StringComparer.Ordinal)
                .First().Key);
        if (spelling.Count == 0) return draft;

        return draft with
        {
            Workouts = draft.Workouts.Select(workout => workout with
            {
                Exercises = workout.Exercises.Select(exercise =>
                    spelling.TryGetValue(CatalogService.Normalize(exercise.SourceName.Trim()), out var name)
                        ? exercise with { SourceName = name }
                        : exercise).ToList()
            }).ToList()
        };
    }

    /// A small-caps font draws its capitals and small letters as separate runs, so a word reads
    /// "BenCh" or "InClIne". A capital straight after a small letter inside one word is never how
    /// a name is spelled, so that word is written in title case.
    private static ImportDraft WithRepairedCase(ImportDraft draft) => draft with
    {
        Workouts = draft.Workouts.Select(workout => workout with
        {
            Exercises = workout.Exercises.Select(exercise => exercise with { SourceName = RepairCase(exercise.SourceName) }).ToList()
        }).ToList()
    };

    internal static string RepairCase(string name)
        => string.Join(' ', name.Split(' ').Select(word => MixedCaseWord.IsMatch(word)
            ? char.ToUpperInvariant(word[0]) + word[1..].ToLowerInvariant()
            : word));

    private static readonly System.Text.RegularExpressions.Regex MixedCaseWord = new("[a-z][A-Z]",
        System.Text.RegularExpressions.RegexOptions.Compiled);
}
