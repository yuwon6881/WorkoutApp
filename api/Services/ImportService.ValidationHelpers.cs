using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

internal sealed class ImportVerificationException(ImportReviewIssue issue)
    : DomainException(Describe(issue), 422)
{
    public ImportReviewIssue Issue { get; } = issue;

    private static string Describe(ImportReviewIssue issue)
    {
        var location = issue.SourcePage is { } page ? $" on PDF page {page}" : "";
        var field = string.IsNullOrWhiteSpace(issue.TargetField) ? "" : $" (field: {issue.TargetField})";
        return $"The PDF could not be verified completely [{issue.Code}]{location}{field}: {issue.Message}";
    }
}

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

    private static ImportChunkReconciliation.ChunkMerge ReconcileChunkCoverage(ImportDraft existing, ImportDraft extracted, ImportChunk chunk,
        IReadOnlyList<ImportPageText>? pages = null, bool preserveTrailingRestDays = false,
        IReadOnlyDictionary<int, int>? printedWeeks = null)
        => ImportChunkReconciliation.ReconcileChunkCoverage(existing, extracted, chunk, pages, preserveTrailingRestDays, printedWeeks);

    /// A week the source confirms as longer than seven days keeps its trailing rest days.
    private static (List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices) ReconcileDayShape(List<DraftWorkout> days,
        int? sourceWeekDays = null)
        => ImportDayShape.Reconcile(days, preserveTrailingRestDays: sourceWeekDays is > Workout.Api.Domain.ProgramLimits.StandardDaysPerWeek);

    private static List<ImportReviewIssue> ReadNotices(string json) => ImportValidation.ReadNotices(json);

    private static void RequireVerifiedDraft(ImportDraft draft, AiImport import, IEnumerable<ImportReviewIssue> currentNotices)
    {
        var notices = ImportReviewNotices.Merge(ReadNotices(import.NoticesJson), currentNotices);
        var unresolved = FilterNotices(notices, draft).Concat(ReviewIssues(draft))
            .FirstOrDefault(issue => issue.Severity != "info");
        if (unresolved is not null) throw new ImportVerificationException(unresolved);
    }

    private static List<ImportReviewIssue> FilterNotices(IEnumerable<ImportReviewIssue> notices, ImportDraft? draft)
    {
        if (draft is null) return notices.ToList();
        var workoutIds = draft.Workouts.Select(w => w.LineId).ToHashSet();
        var exerciseIds = draft.Workouts.SelectMany(w => w.Exercises).Select(e => e.LineId).ToHashSet();
        return notices.Where(n =>
            !ImportReviewNotices.IsResolved(n, draft) &&
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
