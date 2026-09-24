namespace Workout.Api.Services;

/// Coalesces a repeated block banner when it resumes after a later, intervening block.
///
/// A document that prints its banner on every week's first page can mislabel a later week, so the
/// same block label arrives twice with another block between them. That is reconciled in the
/// outline as well as in the finished days: grouped by label alone, the second run's weeks are not
/// contiguous with the first's, which the chunk range check reads as a skipped week and refuses
/// before any section has been read.
internal static class ImportBlockRuns
{
    internal sealed record Result(List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices);
    internal sealed record ChunkResult(List<ImportChunk> Chunks, List<ImportReviewIssue> Notices);
    private sealed record Run(string Label, int MinWeek, int MaxWeek, List<int> Indexes);

    public static Result Reconcile(IReadOnlyList<DraftWorkout> workouts)
    {
        var runs = BuildRuns(workouts.Select((workout, index) => (
                Label: ImportValidation.CanonicalBlock(workout.Block),
                FromWeek: workout.Week, ToWeek: workout.Week, Page: index, Index: index)));

        var normalized = workouts.ToList();
        var notices = new List<ImportReviewIssue>();
        foreach (var (run, label) in ResumedRuns(runs))
        {
            foreach (var index in run.Indexes) normalized[index] = normalized[index] with { Block = label };
            var sourcePage = run.Indexes.Select(index => normalized[index].SourcePage).FirstOrDefault(page => page.HasValue);
            notices.Add(Notice(run.Label, label, sourcePage));
        }

        return new Result(normalized, notices);
    }

    public static ChunkResult ReconcileChunks(IReadOnlyList<ImportChunk> chunks)
    {
        var runs = BuildRuns(chunks.Select((chunk, index) => (
                Label: ImportValidation.CanonicalBlock(chunk.Block),
                FromWeek: chunk.WeekFrom, ToWeek: chunk.WeekTo, Page: chunk.PageFrom, Index: index))
            .OrderBy(item => item.Page).ThenBy(item => item.Index));

        var normalized = chunks.ToList();
        var notices = new List<ImportReviewIssue>();
        foreach (var (run, label) in ResumedRuns(runs))
        {
            foreach (var index in run.Indexes) normalized[index] = normalized[index] with { Block = label };
            notices.Add(Notice(run.Label, label, run.Indexes.Min(index => normalized[index].PageFrom)));
        }

        return new ChunkResult(normalized, notices);
    }

    private static List<Run> BuildRuns(IEnumerable<(string Label, int FromWeek, int ToWeek, int Page, int Index)> items)
    {
        var runs = new List<Run>();
        foreach (var item in items)
        {
            if (runs.Count == 0 || !runs[^1].Label.Equals(item.Label, StringComparison.OrdinalIgnoreCase))
            {
                runs.Add(new Run(item.Label, item.FromWeek, item.ToWeek, [item.Index]));
                continue;
            }

            var last = runs[^1];
            runs[^1] = last with
            {
                MinWeek = Math.Min(last.MinWeek, item.FromWeek),
                MaxWeek = Math.Max(last.MaxWeek, item.ToWeek),
                Indexes = [.. last.Indexes, item.Index]
            };
        }
        return runs;
    }

    /// A run resumes an earlier block when that label already closed on an earlier week and the
    /// run immediately before it carries a label of its own. A label that reappears within weeks
    /// the earlier run already covered is a parallel choice rather than a continuation, and is
    /// left as the document printed it.
    private static IEnumerable<(Run Run, string Label)> ResumedRuns(List<Run> runs)
    {
        for (var index = 2; index < runs.Count; index++)
        {
            var run = runs[index];
            if (run.Label.Length == 0) continue;
            var preceding = runs[index - 1];
            if (preceding.Label.Length == 0) continue;
            var prior = runs.Take(index).LastOrDefault(candidate =>
                candidate.Label.Equals(run.Label, StringComparison.OrdinalIgnoreCase));
            if (prior is null || prior.MaxWeek >= run.MinWeek) continue;
            yield return (run, preceding.Label);
        }
    }

    private static ImportReviewIssue Notice(string repeated, string label, int? sourcePage)
        => new("block_label_repeated",
            $"The printed {repeated} banner followed {label}, so this later run continues {label}.",
            "info", sourcePage);
}
