using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// A 21s-style set prints its target as segments ("7/7/7") that the exercise note describes as
/// ranges of motion inside one continuous set ("first 7 bottom half, next 7 top half, last 7 full
/// ROM"). The lifter performs and logs the whole set, so its rep target is the total; the printed
/// segments stay as the set's rep text, which is what the page says.
///
/// Only segments the note spells out, in the same order and counts, are totalled. A slash with no
/// such note, such as a drop set's "15/15", describes separate efforts and is left as it was read.
internal static class ImportRomRepTotals
{
    private static readonly Regex Segmented = new(@"^\s*\d{1,3}(?:\s*[/+]\s*\d{1,3})+\s*$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static ImportDraft Apply(ImportDraft draft)
        => draft with
        {
            Workouts = draft.Workouts.Select(day => day with { Exercises = day.Exercises.Select(Apply).ToList() }).ToList()
        };

    private static DraftExercise Apply(DraftExercise exercise)
    {
        var segments = ImportValidation.RomSegmentCounts(exercise.Notes);
        if (segments.Count < 2 || segments.Any(count => count <= 0)) return exercise;
        return exercise with { Sets = exercise.Sets.Select(set => Total(set, segments)).ToList() };
    }

    private static DraftSet Total(DraftSet set, IReadOnlyList<int> segments)
    {
        if (set.Warmup || set.RepsText is not { } text || !Segmented.IsMatch(text)) return set;
        var printed = Regex.Matches(text, @"\d+")
            .Select(match => int.Parse(match.Value, NumberStyles.None, CultureInfo.InvariantCulture)).ToList();
        if (!printed.SequenceEqual(segments)) return set;
        var total = printed.Sum();
        return set with { RepMin = total, RepMax = total };
    }
}
