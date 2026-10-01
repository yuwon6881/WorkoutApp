using System.Text.Json;

namespace Workout.Api.Services;

/// What the reviewer has changed since the read finished.
///
/// An actionable review item points at something the read could not settle by itself: a value it
/// could not confirm, or a document that contradicts itself. Editing the exercise, day or pages it
/// points at is the reviewer making that call, so the item stops blocking. The comparison is made
/// against the extracted baseline rather than a stored acknowledgement, so undoing the edit or
/// restoring the draft brings the item straight back.
///
/// Structural checks are not settled this way: a missing week or an overfull one is re-derived
/// from the draft itself and clears only when the draft's shape actually changes.
internal sealed class ImportReviewEdits
{
    private static readonly HashSet<string> StructuralCodes = new(StringComparer.Ordinal)
    {
        "chunk_day_count",
        "week_day_overflow",
        "program_week_gap",
        "phase_week_gap"
    };

    public static readonly ImportReviewEdits None = new([], [], []);

    private readonly HashSet<Guid> exercises;
    private readonly HashSet<Guid> days;
    private readonly HashSet<int> pages;

    private ImportReviewEdits(HashSet<Guid> exercises, HashSet<Guid> days, HashSet<int> pages)
    {
        this.exercises = exercises;
        this.days = days;
        this.pages = pages;
    }

    public bool ExerciseEdited(Guid lineId) => exercises.Contains(lineId);

    /// Whether the reviewer has already acted on this item by editing what it points at.
    public bool Reviewed(ImportReviewIssue issue)
    {
        if (issue.Severity.Equals("info", StringComparison.OrdinalIgnoreCase)) return false;
        if (StructuralCodes.Contains(issue.Code)) return false;
        if (issue.ExerciseLineId is { } exercise) return exercises.Contains(exercise);
        if (issue.WorkoutLineId is { } day) return days.Contains(day);
        if (issue.SourcePage is not { } from) return false;
        var to = Math.Max(from, issue.SourcePageTo ?? from);
        return pages.Any(page => page >= from && page <= to);
    }

    public static ImportReviewEdits Compare(string? baselineJson, ImportDraft? current)
    {
        if (current is null || string.IsNullOrWhiteSpace(baselineJson)) return None;
        ImportDraft baseline;
        try { baseline = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(baselineJson)); }
        catch (JsonException) { return None; }
        return Compare(baseline, current);
    }

    public static ImportReviewEdits Compare(ImportDraft baseline, ImportDraft current)
    {
        var baselineDays = baseline.Workouts.GroupBy(day => day.LineId).ToDictionary(group => group.Key, group => group.First());
        var baselineExercises = baseline.Workouts.SelectMany(day => day.Exercises)
            .GroupBy(exercise => exercise.LineId).ToDictionary(group => group.Key, group => group.First());
        var editedExercises = new HashSet<Guid>();
        var editedDays = new HashSet<Guid>();
        var editedPages = new HashSet<int>();

        foreach (var day in current.Workouts)
        {
            baselineDays.TryGetValue(day.LineId, out var before);
            if (before is null || ImportService.WorkoutDiffers(day, before))
            {
                editedDays.Add(day.LineId);
                AddPage(editedPages, day.SourcePage);
                AddPage(editedPages, before?.SourcePage);
            }
            foreach (var exercise in day.Exercises)
            {
                baselineExercises.TryGetValue(exercise.LineId, out var original);
                if (original is not null && !ImportService.ExerciseDiffers(exercise, original)) continue;
                editedExercises.Add(exercise.LineId);
                AddPage(editedPages, exercise.SourcePage ?? day.SourcePage);
            }
        }

        // A day the reviewer deleted still answers an item about the pages it came from.
        var currentDays = current.Workouts.Select(day => day.LineId).ToHashSet();
        foreach (var removed in baseline.Workouts.Where(day => !currentDays.Contains(day.LineId)))
            AddPage(editedPages, removed.SourcePage);

        return new ImportReviewEdits(editedExercises, editedDays, editedPages);
    }

    private static void AddPage(HashSet<int> pages, int? page)
    {
        if (page is { } value) pages.Add(value);
    }
}
