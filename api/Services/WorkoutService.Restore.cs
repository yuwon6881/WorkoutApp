using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record SessionExerciseRestoreInput(Guid SessionExerciseId, int? Revision = null, Guid? IdempotencyId = null);

public record SessionExerciseBaseline(
    Guid? ExerciseId,
    string NameSnapshot,
    string Note,
    string PrescriptionJson,
    string SequenceGroup,
    string SubstitutionsJson,
    string LoadModel,
    string ProgressionJson,
    List<BaselineSetSnapshot> PlannedSets,
    int? SourcePage = null,
    int? RestSeconds = null,
    string? DemoUrl = null);

public record BaselineSetSnapshot(
    int Position,
    int? WorkingSetOrdinal,
    double? WeightKg,
    int? Reps,
    double? Rpe,
    bool Warmup,
    string SuggestionJson,
    string ResistanceMode,
    double? SystemLoadKg);

public sealed partial class WorkoutService
{
    public static string CreateExerciseBaseline(SessionExercise exercise, IEnumerable<CompletedSet> sets)
    {
        var baselineSets = sets.OrderBy(s => s.Position).Select(s => new BaselineSetSnapshot(
            s.Position, s.WorkingSetOrdinal, s.WeightKg, s.Reps, s.Rpe,
            s.Warmup, s.SuggestionJson, s.ResistanceMode, s.SystemLoadKg)).ToList();

        return Json.Write(new SessionExerciseBaseline(
            exercise.ExerciseId, exercise.NameSnapshot, exercise.Note, exercise.PrescriptionJson,
            exercise.SequenceGroup, exercise.SubstitutionsJson, exercise.LoadModel,
            exercise.ProgressionJson, baselineSets, exercise.SourcePage, exercise.RestSeconds, exercise.DemoUrl));
    }

    public async Task<SessionView> RestoreExercise(Guid id, SessionExerciseRestoreInput input, CancellationToken ct)
    {
        var requestHash = Fingerprint(input);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        var targetSession = session!;
        var replay = await ReplayWorkoutMutation(id, input.IdempotencyId, "workout.exercise.restore", requestHash, ct);
        if (replay is not null)
        {
            await gate.Commit(ct);
            return replay;
        }
        Validation.Require(targetSession.Active, "This workout is already saved to your history.", 409);
        TemplateService.RequireFresh(input.Revision, targetSession.Revision);

        var source = await db.SessionExercises.SingleOrDefaultAsync(e => e.Id == input.SessionExerciseId && e.SessionId == id, ct);
        Validation.Require(source != null, "That exercise is no longer in this workout.", 404);
        var sourceRow = source!;

        var sets = await db.Sets.Where(s => s.SessionExerciseId == sourceRow.Id).OrderBy(s => s.Position).ToListAsync(ct);
        Validation.Require(!string.IsNullOrEmpty(sourceRow.BaselineJson), "This exercise cannot be restored to its default.", 409);

        // An exercise already matching its plan is left alone, so a repeated tap changes nothing.
        if (!await RestoreToBaseline(targetSession, sourceRow, sets, ct))
        {
            await gate.Commit(ct);
            return await Get(id, ct);
        }

        targetSession.Revision++;
        await RecordWorkoutMutation(input.IdempotencyId, id, "workout.exercise.restore", requestHash, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    /// The exercise is swapped back only while nothing is logged on it (logged sets belong to the
    /// movement actually lifted); its plan always returns. False when there was nothing to restore.
    private async Task<bool> RestoreToBaseline(WorkoutSession session, SessionExercise sourceRow, List<CompletedSet> sets, CancellationToken ct)
    {
        var baseline = Json.Read<SessionExerciseBaseline>(sourceRow.BaselineJson);
        var restoreIdentity = !sets.Any(s => s.Done) && IdentityDiffers(sourceRow, baseline);
        if (!restoreIdentity && !SessionPlanRestore.PlanDiffers(baseline, sourceRow.PrescriptionJson, sets)) return false;

        var plan = SessionPlanRestore.Apply(baseline, sets);
        db.Sets.RemoveRange(plan.Removed);
        SessionPlanRestore.ApplyTo(plan, session.UserId, sourceRow.Id, row => db.Sets.Add(row));
        sourceRow.PrescriptionJson = Json.Write(plan.Prescription);
        if (!restoreIdentity) return true;

        sourceRow.ExerciseId = baseline.ExerciseId;
        sourceRow.NameSnapshot = baseline.NameSnapshot;
        sourceRow.SequenceGroup = baseline.SequenceGroup;
        sourceRow.SubstitutionsJson = baseline.SubstitutionsJson;
        sourceRow.LoadModel = baseline.LoadModel;
        sourceRow.ProgressionJson = baseline.ProgressionJson;
        sourceRow.SourcePage = baseline.SourcePage;
        sourceRow.RestSeconds = baseline.RestSeconds;
        sourceRow.DemoUrl = baseline.DemoUrl ?? ImportDemoLinks.ForName(
            Json.Read<Dictionary<string, string>>(sourceRow.DemoLinksJson), baseline.NameSnapshot) ?? "";
        sourceRow.IsReplacement = false;
        sourceRow.OriginalExerciseId = null;
        sourceRow.OriginalNameSnapshot = "";
        sourceRow.SwapGroupKey = null;

        // The swap is undone, so its pending permanent-swap record for this slot goes too.
        var pendingSubs = await db.ExerciseSubstitutions.Where(s => s.SessionId == session.Id &&
            ((sourceRow.SourceSlotKey != null && s.SourceSlotKey == sourceRow.SourceSlotKey) ||
             (sourceRow.SourceTemplateExerciseId != null && s.SourceTemplateExerciseId == sourceRow.SourceTemplateExerciseId))).ToListAsync(ct);
        db.ExerciseSubstitutions.RemoveRange(pendingSubs);
        return true;
    }

    internal static bool IdentityDiffers(SessionExercise row, SessionExerciseBaseline baseline)
        => row.IsReplacement || row.ExerciseId != baseline.ExerciseId || row.NameSnapshot != baseline.NameSnapshot;

    /// Whether Restore default would change anything: a swap still undoable, or a plan edited since the start.
    internal static bool CanRestore(SessionExercise row, IReadOnlyCollection<CompletedSet> sets)
    {
        if (string.IsNullOrEmpty(row.BaselineJson)) return false;
        var baseline = Json.Read<SessionExerciseBaseline>(row.BaselineJson);
        return (!sets.Any(s => s.Done) && IdentityDiffers(row, baseline))
            || SessionPlanRestore.PlanDiffers(baseline, row.PrescriptionJson, sets);
    }
}
