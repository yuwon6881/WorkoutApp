using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Combines the model's page-local reading with the portions already accepted from earlier chunks.
/// Outline coverage is advisory, while structurally repeated pages are reconciled before display.
internal static class ImportChunkReconciliation
{
    public sealed record ChunkMerge(List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices);

    public static bool AreStructurallyIdentical(DraftWorkout a, DraftWorkout b)
    {
        if (a.Week != b.Week) return false;
        if (a.SourcePage == null || b.SourcePage == null || a.SourcePage != b.SourcePage) return false;
        if (a.IsRestDay != b.IsRestDay) return false;
        if (a.IsRestDay) return true;
        if (!string.Equals(a.Name.Trim(), b.Name.Trim(), StringComparison.OrdinalIgnoreCase)) return false;
        if (a.Exercises.Count != b.Exercises.Count) return false;
        for (var i = 0; i < a.Exercises.Count; i++)
        {
            var exA = a.Exercises[i];
            var exB = b.Exercises[i];
            if (!string.Equals(exA.SourceName.Trim(), exB.SourceName.Trim(), StringComparison.OrdinalIgnoreCase)) return false;
            if (exA.Sets.Count != exB.Sets.Count) return false;
            for (var s = 0; s < exA.Sets.Count; s++)
            {
                var setA = exA.Sets[s];
                var setB = exB.Sets[s];
                if (setA.RepMin != setB.RepMin || setA.RepMax != setB.RepMax) return false;
                if (setA.TargetRpe != setB.TargetRpe) return false;
                if (setA.RestSeconds != setB.RestSeconds) return false;
            }
        }
        return true;
    }

    public static ChunkMerge ReconcileChunkCoverage(ImportDraft existing, ImportDraft extracted, ImportChunk chunk)
    {
        var shaped = ImportDayShape.Reconcile(extracted.Workouts);
        var notices = new List<ImportReviewIssue>(shaped.Notices);
        var strayed = shaped.Workouts.Where(day => day.Week < chunk.WeekFrom || day.Week > chunk.WeekTo).ToList();
        if (strayed.Count > 0)
            notices.Add(new ImportReviewIssue("day_outside_section_weeks",
                $"'{chunk.Label}' covers weeks {chunk.WeekFrom}-{chunk.WeekTo} but read {string.Join(", ", strayed.Select(day => day.Name).Distinct())} as week {string.Join(", ", strayed.Select(day => day.Week).Distinct().Order())}. The pages were followed; check the order in the review.",
                "warning", strayed[0].SourcePage ?? chunk.PageFrom, WorkoutLineId: strayed[0].LineId, TargetField: "week"));

        // Coverage describes everything the section read, before repeated days are removed.
        var sectionDayCount = shaped.Workouts.Count;
        var existingKeys = existing.Workouts.Select(DayKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var workouts = new List<DraftWorkout>();
        var droppedEarlierDuplicates = new List<DraftWorkout>();
        var repeated = 0;

        foreach (var day in shaped.Workouts)
        {
            if (workouts.Any(workout => AreStructurallyIdentical(workout, day))) continue;
            var key = DayKey(day);
            if (existingKeys.Contains(key))
            {
                droppedEarlierDuplicates.Add(day);
                continue;
            }
            if (!seen.Add(key)) repeated++;
            workouts.Add(day);
        }

        if (droppedEarlierDuplicates.Count > 0)
        {
            var first = droppedEarlierDuplicates[0];
            var key = DayKey(first);
            notices.Add(new ImportReviewIssue("duplicate_day_dropped",
                $"'{chunk.Label}' repeated {droppedEarlierDuplicates.Count} day{(droppedEarlierDuplicates.Count == 1 ? "" : "s")} already covered by another section; each was kept once.",
                "info", first.SourcePage ?? chunk.PageFrom,
                WorkoutLineId: existing.Workouts.FirstOrDefault(existingDay => DayKey(existingDay) == key)?.LineId,
                TargetField: "name"));
        }

        if (repeated > 0)
            notices.Add(new ImportReviewIssue("repeated_day",
                $"'{chunk.Label}' lists {repeated} day{(repeated == 1 ? "" : "s")} that read identically. Both were kept — delete one in the review if the document only has it once.",
                "warning", chunk.PageFrom));

        if (sectionDayCount * 2 < chunk.DayCount)
            notices.Add(new ImportReviewIssue("chunk_day_count",
                $"'{chunk.Label}' was outlined as about {chunk.DayCount} day{(chunk.DayCount == 1 ? "" : "s")} but reads as {sectionDayCount}. Check that section in the review.",
                "warning", chunk.PageFrom));

        return new ChunkMerge(workouts, notices);
    }

    private static string DayKey(DraftWorkout day)
        => $"{day.Week}|{day.PhaseWeek}|{day.Block?.Trim()}|{day.Phase?.Trim()}|{day.SourcePage}|{day.Name.Trim()}";
}
