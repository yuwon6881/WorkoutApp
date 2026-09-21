namespace Workout.Api.Services;

/// Coalesces a repeated block banner when it resumes after a later, intervening block.
internal static class ImportBlockRuns
{
    internal sealed record Result(List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices);
    private sealed record Run(string Label, int MinWeek, int MaxWeek, List<int> WorkoutIndexes);

    public static Result Reconcile(IReadOnlyList<DraftWorkout> workouts)
    {
        var ordered = workouts.Select((workout, index) => (Workout: workout, Index: index))
            .OrderBy(item => item.Workout.Week).ThenBy(item => item.Index).ToList();
        var runs = new List<Run>();
        foreach (var item in ordered)
        {
            var label = ImportValidation.CanonicalBlock(item.Workout.Block);
            if (runs.Count == 0 || !runs[^1].Label.Equals(label, StringComparison.OrdinalIgnoreCase))
                runs.Add(new Run(label, item.Workout.Week, item.Workout.Week, [item.Index]));
            else
            {
                var last = runs[^1];
                runs[^1] = last with
                {
                    MinWeek = Math.Min(last.MinWeek, item.Workout.Week),
                    MaxWeek = Math.Max(last.MaxWeek, item.Workout.Week),
                    WorkoutIndexes = [.. last.WorkoutIndexes, item.Index]
                };
            }
        }

        var normalized = workouts.ToList();
        var notices = new List<ImportReviewIssue>();
        for (var runIndex = 0; runIndex < runs.Count; runIndex++)
        {
            var run = runs[runIndex];
            if (run.Label.Length == 0 || runIndex < 2) continue;
            var preceding = runs[runIndex - 1];
            var priorMatch = runs.Take(runIndex).LastOrDefault(candidate =>
                candidate.Label.Equals(run.Label, StringComparison.OrdinalIgnoreCase));
            if (priorMatch is null || priorMatch.MaxWeek >= run.MinWeek || preceding.Label.Length == 0) continue;

            foreach (var workoutIndex in run.WorkoutIndexes)
                normalized[workoutIndex] = normalized[workoutIndex] with { Block = preceding.Label };
            var sourcePage = run.WorkoutIndexes.Select(index => normalized[index].SourcePage).FirstOrDefault(page => page.HasValue);
            notices.Add(new ImportReviewIssue("block_label_repeated",
                $"The printed {run.Label} banner followed {preceding.Label}, so this later run continues {preceding.Label}.",
                "info", sourcePage));
        }

        return new Result(normalized, notices);
    }
}
