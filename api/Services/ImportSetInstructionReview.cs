using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// A note that explicitly instructs a numbered set cannot silently refer past the prescription.
internal static class ImportSetInstructionReview
{
    private static readonly Regex NumberedSet = new(@"\b(?:for|on)\s+(?:working\s+)?set\s+(?<number>\d{1,2})\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static List<ImportReviewIssue> Issues(IEnumerable<DraftWorkout> workouts)
    {
        var issues = new List<ImportReviewIssue>();
        foreach (var day in workouts)
        foreach (var exercise in day.Exercises)
        {
            var count = exercise.Sets.Count(set => !set.Warmup);
            if (count == 0) continue;
            var notes = exercise.Notes ?? "";
            if (Regex.IsMatch(notes, @"\bavoid\s+failure\b", RegexOptions.IgnoreCase)
                && Regex.IsMatch(notes, @"\b(?:final|last)\s+set\s+of\s+each\s+exercise\s+to\s+failure\b", RegexOptions.IgnoreCase))
                issues.Add(new ImportReviewIssue("effort_instruction_conflict",
                    "This exercise says to avoid failure, but its table footer says to take each exercise's final set to failure. Resolve the source instructions before creating the program.",
                    "warning", exercise.SourcePage ?? day.SourcePage,
                    WorkoutLineId: day.LineId, ExerciseLineId: exercise.LineId, TargetField: "targetRpe"));
            var stated = NumberedSet.Matches(exercise.Notes ?? "").Cast<Match>()
                .Select(match => int.Parse(match.Groups["number"].Value, CultureInfo.InvariantCulture))
                .DefaultIfEmpty(0).Max();
            if (stated <= count) continue;
            issues.Add(new ImportReviewIssue("working_set_instruction_conflict",
                $"The instructions refer to working set {stated}, but this exercise has {count} working sets. Check the printed set count and instructions before creating the program.",
                "warning", exercise.SourcePage ?? day.SourcePage,
                WorkoutLineId: day.LineId, ExerciseLineId: exercise.LineId, TargetField: "sets"));
        }
        return issues;
    }
}
