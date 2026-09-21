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
    int? SourcePage = null);

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
            exercise.ProgressionJson, baselineSets, exercise.SourcePage));
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
        Validation.Require(!sets.Any(s => s.Done), "Cannot restore an exercise after completing sets.", 409);
        Validation.Require(!string.IsNullOrEmpty(sourceRow.BaselineJson), "This exercise cannot be restored to its default.", 409);

        var baseline = Json.Read<SessionExerciseBaseline>(sourceRow.BaselineJson);
        var hasRestorableChange = sourceRow.IsReplacement ||
            sourceRow.ExerciseId != baseline.ExerciseId ||
            sourceRow.NameSnapshot != baseline.NameSnapshot;
        Validation.Require(hasRestorableChange, "No restorable change exists for this exercise.", 409);

        sourceRow.ExerciseId = baseline.ExerciseId;
        sourceRow.NameSnapshot = baseline.NameSnapshot;
        sourceRow.Note = baseline.Note;
        sourceRow.PrescriptionJson = baseline.PrescriptionJson;
        sourceRow.SequenceGroup = baseline.SequenceGroup;
        sourceRow.SubstitutionsJson = baseline.SubstitutionsJson;
        sourceRow.LoadModel = baseline.LoadModel;
        sourceRow.ProgressionJson = baseline.ProgressionJson;
        sourceRow.SourcePage = baseline.SourcePage;
        sourceRow.IsReplacement = false;
        sourceRow.OriginalExerciseId = null;
        sourceRow.OriginalNameSnapshot = "";
        sourceRow.SwapGroupKey = null;

        var baselinePositions = baseline.PlannedSets.Select(b => b.Position).ToHashSet();
        db.Sets.RemoveRange(sets.Where(s => !baselinePositions.Contains(s.Position)));

        foreach (var bSet in baseline.PlannedSets)
        {
            var existing = sets.FirstOrDefault(s => s.Position == bSet.Position);
            if (existing == null)
            {
                existing = new CompletedSet
                {
                    UserId = targetSession.UserId,
                    SessionExerciseId = sourceRow.Id,
                    Position = bSet.Position
                };
                db.Sets.Add(existing);
            }
            existing.WorkingSetOrdinal = bSet.WorkingSetOrdinal;
            existing.WeightKg = bSet.WeightKg;
            existing.Reps = bSet.Reps;
            existing.Rpe = bSet.Rpe;
            existing.Warmup = bSet.Warmup;
            existing.Done = false;
            existing.SuggestionJson = bSet.SuggestionJson;
            existing.ResistanceMode = bSet.ResistanceMode;
            existing.SystemLoadKg = bSet.SystemLoadKg;
        }

        // Remove pending permanent-swap records for this slot
        var pendingSubs = await db.ExerciseSubstitutions.Where(s => s.SessionId == id &&
            ((sourceRow.SourceSlotKey != null && s.SourceSlotKey == sourceRow.SourceSlotKey) ||
             (sourceRow.SourceTemplateExerciseId != null && s.SourceTemplateExerciseId == sourceRow.SourceTemplateExerciseId))).ToListAsync(ct);
        db.ExerciseSubstitutions.RemoveRange(pendingSubs);

        targetSession.Revision++;
        await RecordWorkoutMutation(input.IdempotencyId, id, "workout.exercise.restore", requestHash, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }
}
