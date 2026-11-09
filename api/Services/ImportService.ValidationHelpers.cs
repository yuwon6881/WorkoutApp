using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    public Task ValidateDraft(ImportDraft draft, CancellationToken ct) => ImportValidation.ValidateDraft(draft, catalog, ct);

    private Task ValidateWorkout(DraftWorkout workout, CancellationToken ct) => ImportValidation.ValidateWorkout(workout, catalog, ct);

    private static SetPrescription ToPrescription(DraftSet set) => ImportValidation.ToPrescription(set);

    private static List<ImportReviewIssue> ReadNotices(string json) => string.IsNullOrWhiteSpace(json) ? [] : Json.Read<List<ImportReviewIssue>>(json);

    private static List<ImportReviewIssue> FilterNotices(IEnumerable<ImportReviewIssue> notices, ImportDraft? draft,
        ImportReviewEdits? edits = null)
    {
        if (draft is null) return notices.ToList();
        var reviewed = edits ?? ImportReviewEdits.None;
        var workoutIds = draft.Workouts.Select(w => w.LineId).ToHashSet();
        var exerciseIds = draft.Workouts.SelectMany(w => w.Exercises).Select(e => e.LineId).ToHashSet();
        return notices.Where(n =>
            !ImportReviewNotices.IsResolved(n, draft) &&
            !reviewed.Reviewed(n) &&
            (n.WorkoutLineId == null || workoutIds.Contains(n.WorkoutLineId.Value)) &&
            (n.ExerciseLineId == null || exerciseIds.Contains(n.ExerciseLineId.Value))).ToList();
    }

    private void UpdateCounters(AiImport import, ImportDraft draft)
    {
        var unresolved = Unresolved(draft);
        import.UnresolvedCount = unresolved.Count;
    }
}
