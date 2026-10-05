using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record SessionRestoreInput(int? Revision = null, Guid? IdempotencyId = null);

public sealed partial class WorkoutService
{
    /// Puts a workout started from a plan back to that plan without losing work: every planned
    /// exercise returns to its start snapshot (RestoreToBaseline), exercises added since go unless
    /// something was logged on them, planned exercises removed since come back with suggestions
    /// from the session's frozen context, and the plan's order returns. Nothing to change is a no-op.
    public async Task<SessionView> RestoreWorkout(Guid id, SessionRestoreInput input, CancellationToken ct)
    {
        var requestHash = Fingerprint(input);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var found = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(found != null, "That workout no longer exists.", 404);
        var session = found!;
        var replay = await ReplayWorkoutMutation(id, input.IdempotencyId, "workout.restore", requestHash, ct);
        if (replay is not null)
        {
            await gate.Commit(ct);
            return replay;
        }
        Validation.Require(session.Active, "This workout is already saved to your history.", 409);
        TemplateService.RequireFresh(input.Revision, session.Revision);
        Validation.Require(session.TemplateId != null, "Only a workout started from a plan can be restored to it.", 409);

        var exercises = await db.SessionExercises.Where(e => e.SessionId == id).OrderBy(e => e.Position).ToListAsync(ct);
        var exerciseIds = exercises.Select(e => e.Id).ToList();
        var sets = (await db.Sets.Where(s => exerciseIds.Contains(s.SessionExerciseId)).ToListAsync(ct))
            .ToLookup(s => s.SessionExerciseId);
        var changed = false;
        var kept = new List<SessionExercise>();
        foreach (var exercise in exercises)
        {
            var own = sets[exercise.Id].OrderBy(s => s.Position).ToList();
            if (!string.IsNullOrEmpty(exercise.BaselineJson))
                changed |= await RestoreToBaseline(session, exercise, own, ct);
            else if (!own.Any(s => s.Done))
            {
                db.Sets.RemoveRange(own);
                db.SessionExercises.Remove(exercise);
                changed = true;
                continue;
            }
            kept.Add(exercise);
        }

        var startPlan = SessionStartPlan.Read(session, exercises);
        var present = kept.Select(row => row.SourceTemplateExerciseId).ToHashSet();
        foreach (var saved in startPlan.Where(row => !present.Contains(row.SourceTemplateExerciseId)))
        {
            kept.Add(SessionStartPlan.Restore(db, session, saved));
            changed = true;
        }

        // The plan's order first; anything kept beyond the plan follows in its current order.
        var planOrder = startPlan.Where(row => row.SourceTemplateExerciseId is not null)
            .ToDictionary(row => row.SourceTemplateExerciseId!.Value, row => row.Position);
        var ordered = kept
            .Select((exercise, index) => (exercise, index))
            .OrderBy(x => x.exercise.SourceTemplateExerciseId is { } source && planOrder.TryGetValue(source, out var at) ? at : planOrder.Count + x.index)
            .Select(x => x.exercise).ToList();
        for (var position = 0; position < ordered.Count; position++)
        {
            if (ordered[position].Position == position) continue;
            ordered[position].Position = position;
            changed = true;
        }

        if (!changed)
        {
            await gate.Commit(ct);
            return await Get(id, ct);
        }
        session.Revision++;
        await RecordWorkoutMutation(input.IdempotencyId, id, "workout.restore", requestHash, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

}
