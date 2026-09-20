using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    public Task ValidateDraft(ImportDraft draft, CancellationToken ct) => ImportValidation.ValidateDraft(draft, catalog, ct);

    private Task ValidateWorkout(DraftWorkout workout, CancellationToken ct) => ImportValidation.ValidateWorkout(workout, catalog, ct);

    private static SetPrescription ToPrescription(DraftSet set) => ImportValidation.ToPrescription(set);

    private static List<ImportChunk> SplitChunks(List<AiOutlineChunk> source) => ImportValidation.SplitChunks(source);

    private static List<ImportChunk> SplitChunks(List<ImportChunk> source) => ImportValidation.SplitChunks(source);

    private static List<ImportChunk> ReadChunks(string json) => ImportValidation.ReadChunks(json);

    private static (List<DraftWorkout> Workouts, bool Renumbered) NormalizePhaseWeeks(List<DraftWorkout> workouts)
        => ImportValidation.NormalizePhaseWeeks(workouts);

    private static ImportChunkReconciliation.ChunkMerge ReconcileChunkCoverage(ImportDraft existing, ImportDraft extracted, ImportChunk chunk)
        => ImportChunkReconciliation.ReconcileChunkCoverage(existing, extracted, chunk);

    private static (List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices) ReconcileDayShape(List<DraftWorkout> days)
        => ImportDayShape.Reconcile(days);

    private static List<ImportReviewIssue> ReadNotices(string json) => ImportValidation.ReadNotices(json);

    private static List<ImportReviewIssue> FilterNotices(IEnumerable<ImportReviewIssue> notices, ImportDraft? draft)
    {
        if (draft is null) return notices.ToList();
        var workoutIds = draft.Workouts.Select(w => w.LineId).ToHashSet();
        var exerciseIds = draft.Workouts.SelectMany(w => w.Exercises).Select(e => e.LineId).ToHashSet();
        return notices.Where(n =>
            (n.WorkoutLineId == null || workoutIds.Contains(n.WorkoutLineId.Value)) &&
            (n.ExerciseLineId == null || exerciseIds.Contains(n.ExerciseLineId.Value))).ToList();
    }

    private void UpdateCounters(AiImport import, ImportDraft draft)
    {
        var unresolved = Unresolved(draft);
        import.UnresolvedCount = unresolved.Count;
    }

    private static void ValidateChunkPages(IEnumerable<ImportChunk> chunks, string coverageJson)
        => ImportValidation.ValidateChunkPages(chunks, coverageJson);

    private static void ValidateDraftPages(ImportDraft draft, string coverageJson)
        => ImportValidation.ValidateDraftPages(draft, coverageJson);

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
