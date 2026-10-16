using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// A readable numeric RPE outside the supported training range belongs in source review.
internal static class ImportPrintedEffort
{
    private const string Prefix = "Printed RPE requires review: ";
    private static readonly Regex Numeric = new(@"^\s*[~≈]?\s*(?:RPE\s*)?(?<min>\d+(?:\.\d+)?)(?:\s*[-–]\s*(?<max>\d+(?:\.\d+)?))?\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static string? Unusable(string? text)
    {
        // Adjacent %1RM and RPE columns can arrive as one cell, e.g. "75% 3".
        // The percentage remains in LoadText; retain only its effort beside this note.
        var effort = Regex.Replace(text ?? "", @"\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*%\s*(?:1\s*RM)?", "", RegexOptions.IgnoreCase).Trim();
        var match = Numeric.Match(effort);
        if (!match.Success) return null;
        var min = double.Parse(match.Groups["min"].Value, CultureInfo.InvariantCulture);
        var max = match.Groups["max"].Success
            ? double.Parse(match.Groups["max"].Value, CultureInfo.InvariantCulture) : min;
        return min < 5 || max > 10 || max < min ? effort : null;
    }

    public static AiSet Preserve(AiSet set, string? printed)
    {
        if (printed is null) return set;
        var note = $"{Prefix}{printed}.";
        var notes = set.Notes?.Contains(note, StringComparison.Ordinal) == true ? set.Notes
            : string.IsNullOrWhiteSpace(set.Notes) ? note : $"{set.Notes.Trim()} {note}";
        return set with { TargetRpe = null, Rir = null, RpeSource = "extracted", Notes = notes };
    }

    public static bool NeedsReview(DraftSet set)
        => !set.Warmup && set.TargetRpe is null && string.IsNullOrWhiteSpace(set.Rir)
            && set.Notes?.Contains(Prefix, StringComparison.Ordinal) == true;

    public static IEnumerable<ImportReviewIssue> Issues(IEnumerable<DraftWorkout> workouts)
    {
        foreach (var day in workouts)
        foreach (var exercise in day.Exercises)
        {
            var index = exercise.Sets.FindIndex(NeedsReview);
            if (index < 0) continue;
            yield return new ImportReviewIssue("effort_instruction_conflict",
                "The PDF prints an effort outside the supported RPE 5-10 range or a reversed range. The printed value is kept in the set note; choose a target before creating the program.",
                "warning", exercise.Sets[index].SourcePage ?? exercise.SourcePage ?? day.SourcePage,
                WorkoutLineId: day.LineId, ExerciseLineId: exercise.LineId, SetIndex: index, TargetField: "targetRpe");
        }
    }
}
