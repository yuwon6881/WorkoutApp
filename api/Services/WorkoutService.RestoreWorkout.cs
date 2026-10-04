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

        var template = await db.Templates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == session.TemplateId, ct);
        var planned = template is null ? [] : await db.TemplateExercises.AsNoTracking()
            .Where(e => e.TemplateId == template.Id).OrderBy(e => e.Position).ToListAsync(ct);
        var present = kept.Select(e => e.SourceTemplateExerciseId).OfType<Guid>().ToHashSet();
        var missing = planned.Where(plan => !present.Contains(plan.Id)).ToList();
        if (missing.Count > 0)
        {
            var names = await templates.CatalogNames(missing.Select(p => p.ExerciseId), ct);
            var models = await catalog.LoadModelsFor(missing.Select(p => p.ExerciseId), ct);
            var timed = await CatalogService.TrackingModesFor(db, missing.Select(p => p.ExerciseId), ct);
            foreach (var plan in missing)
                kept.Add(await AddPlannedExercise(session, template!, plan, names, models, timed, ct));
            changed = true;
        }

        // The plan's order first; anything kept beyond the plan follows in its current order.
        var planOrder = planned.Select((plan, index) => (plan.Id, index)).ToDictionary(x => x.Id, x => x.index);
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

    /// A planned exercise brought back after it was removed: the same rows Start creates, with set
    /// suggestions read against the session's frozen Nutrition and bodyweight context.
    private async Task<SessionExercise> AddPlannedExercise(WorkoutSession session, WorkoutTemplate template, TemplateExercise plan,
        IReadOnlyDictionary<Guid, string> names, IReadOnlyDictionary<Guid, string> models, IReadOnlyDictionary<Guid, string> timed,
        CancellationToken ct)
    {
        var prescription = Json.Read<List<SetPrescription>>(plan.SetsJson);
        var loadModel = plan.ExerciseId is { } modelId ? models.GetValueOrDefault(modelId, LoadModels.External) : LoadModels.External;
        var exercise = new SessionExercise
        {
            UserId = session.UserId, SessionId = session.Id, ExerciseId = plan.ExerciseId, Position = plan.Position,
            NameSnapshot = plan.ExerciseId is { } catalogId && names.TryGetValue(catalogId, out var resolved) ? resolved : plan.SourceName,
            Note = plan.Note, PrescriptionJson = Json.Write(prescription), SequenceGroup = plan.SequenceGroup,
            RestSeconds = plan.RestSeconds, SubstitutionsJson = plan.SubstitutionsJson, LoadModel = loadModel,
            SourceTemplateExerciseId = plan.Id, SourceSlotKey = plan.SlotKey, SourcePhaseId = template.ProgramPhaseId,
            SourcePage = plan.SourcePage, DemoUrl = plan.DemoUrl, DemoLinksJson = plan.DemoLinksJson
        };
        db.SessionExercises.Add(exercise);

        var isTimed = plan.ExerciseId is { } timedId && timed.ContainsKey(timedId);
        var ordinal = 0;
        var sets = prescription.Select((planSet, index) => new CompletedSet
        {
            UserId = session.UserId, SessionExerciseId = exercise.Id, Position = index,
            Warmup = planSet.Warmup,
            WorkingSetOrdinal = planSet.Warmup ? null : ++ordinal,
            Reps = planSet.Warmup && !isTimed ? planSet.RepMin : null,
            ResistanceMode = planSet.Warmup ? WarmupResistanceMode(loadModel, exercise.NameSnapshot) : ResolveResistanceMode(loadModel, exercise.NameSnapshot)
        }).ToList();
        db.Sets.AddRange(sets);

        await RefreshReplacementSuggestions(session, exercise, sets, loadModel, ct);
        foreach (var set in sets.Where(s => !s.Warmup && !isTimed && s.SuggestionJson.Length > 0))
            set.Reps = Progression.PrefillReps(prescription[set.Position], Json.Read<SetProgressionSuggestion>(set.SuggestionJson));
        exercise.BaselineJson = CreateExerciseBaseline(exercise, sets);
        return exercise;
    }
}
