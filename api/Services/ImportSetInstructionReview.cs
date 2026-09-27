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
            // A table that prints its own rep target for each of these sets ("4, 6" over two
            // sets) settles the prescription; a note naming a later set was carried over from a
            // week that ran more of them. Only a table that does not fit its sets needs review.
            var settled = TablePrintsEachSet(exercise);
            issues.Add(new ImportReviewIssue("working_set_instruction_conflict",
                settled
                    ? $"The note describes working set {stated}, but this week's table prints {count} working sets, each with its own rep target. The table was used."
                    : $"The note describes working set {stated}, but the table prints {count} working sets. Edit the note or the set count so they agree.",
                settled ? "info" : "warning", exercise.SourcePage ?? day.SourcePage,
                WorkoutLineId: day.LineId, ExerciseLineId: exercise.LineId, TargetField: "sets"));
        }
        return issues;
    }

    /// Every working set carries a printed, distinct rep target: the table itself states the
    /// progression across exactly these sets.
    private static bool TablePrintsEachSet(DraftExercise exercise)
    {
        var working = exercise.Sets.Where(set => !set.Warmup).ToList();
        return working.Count > 1
            && working.All(set => set.RepMin is not null && set.RepsSource == "extracted")
            && working.Select(set => (set.RepMin, set.RepMax)).Distinct().Count() == working.Count;
    }
}
