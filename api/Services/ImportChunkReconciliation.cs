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

    public static ChunkMerge ReconcileChunkCoverage(ImportDraft existing, ImportDraft extracted, ImportChunk chunk,
        IReadOnlyList<ImportPageText>? pages = null, bool preserveTrailingRestDays = false,
        bool sourcePageWeekIsAuthoritative = false)
    {
        var pageAnchored = sourcePageWeekIsAuthoritative
            ? extracted.Workouts.Select(day => day.SourcePage is { } page &&
                page >= chunk.PageFrom && page <= chunk.PageTo
                    ? day with { Week = chunk.WeekFrom } : day).ToList()
            : extracted.Workouts;
        var translated = ImportAbsoluteWeeks.TranslateDays(pageAnchored, chunk);
        // Lettered versions of one week are separated before the week is shaped: shaped together
        // they overflow it, and its trailing rest days would be trimmed as surplus.
        var versions = ImportWeekVariants.Separate(translated, pages ?? []);
        var shaped = ImportDayShape.Reconcile(versions.Workouts, preserveTrailingRestDays);
        var notices = new List<ImportReviewIssue>(versions.Notices);
        notices.AddRange(shaped.Notices);
        var strayed = shaped.Workouts.Where(day => !versions.Moved.Contains(day.LineId)
            && (day.Week < chunk.WeekFrom || day.Week > chunk.WeekTo)).ToList();
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

        // Every rest day on a page reads the same, and a page printing one between each of its
        // sessions means each of them. A rest day is a repeat only as part of a repeated session.
        var previousSessionRepeated = false;
        foreach (var day in shaped.Workouts)
        {
            var identical = workouts.Any(workout => AreStructurallyIdentical(workout, day));
            if (!day.IsRestDay) previousSessionRepeated = identical;
            if (identical && (!day.IsRestDay || previousSessionRepeated)) continue;
            var key = DayKey(day);
            if (existingKeys.Contains(key))
            {
                droppedEarlierDuplicates.Add(day);
                continue;
            }
            // A page routinely prints "REST DAY" between each of its sessions, and every one of
            // them reads the same; only a training day that repeats is worth a reviewer's time.
            if (!seen.Add(key) && !day.IsRestDay) repeated++;
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

        var sourceTrainingDays = pages is null
            ? 0
            : ImportDayLabels.Read(pages).Values.Sum(labels => labels.Count);
        var readTrainingDays = shaped.Workouts.Count(day => !day.IsRestDay);
        var underRead = sourceTrainingDays > 0
            ? readTrainingDays < sourceTrainingDays
            : sectionDayCount * 2 < chunk.DayCount;
        if (underRead)
            notices.Add(new ImportReviewIssue("chunk_day_count",
                sourceTrainingDays > 0
                    ? $"'{chunk.Label}' has {sourceTrainingDays} printed training-day title{(sourceTrainingDays == 1 ? "" : "s")} but reads as {readTrainingDays}. Check that section in the review."
                    : $"'{chunk.Label}' was outlined as about {chunk.DayCount} day{(chunk.DayCount == 1 ? "" : "s")} but reads as {sectionDayCount}. Check that section in the review.",
                "warning", chunk.PageFrom, TargetField: "week",
                ExpectedTrainingDays: sourceTrainingDays > 0 ? sourceTrainingDays : null,
                SourcePageTo: sourceTrainingDays > 0 ? chunk.PageTo : null,
                WeekFrom: sourceTrainingDays > 0 ? chunk.WeekFrom : null,
                WeekTo: sourceTrainingDays > 0 ? chunk.WeekTo : null));

        return new ChunkMerge(workouts, notices);
    }

    private static string DayKey(DraftWorkout day)
        => $"{day.Week}|{day.PhaseWeek}|{day.Block?.Trim()}|{day.Phase?.Trim()}|{day.SourcePage}|{day.Name.Trim()}";
}
