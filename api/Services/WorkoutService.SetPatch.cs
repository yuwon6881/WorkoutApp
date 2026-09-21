using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class WorkoutService
{
    /// Updates one set without serializing the whole active workout. The payload is deliberately
    /// presence-aware so a client can clear a nullable value while leaving every omitted field
    /// untouched. The existing full-save contract remains the compatibility path during rollout.
    public async Task<SessionView> PatchSet(Guid sessionId, Guid setId, JsonElement payload, CancellationToken ct)
    {
        Validation.Require(payload.ValueKind == JsonValueKind.Object, "A set change is required.");
        Guid? mutationId = null;
        if (payload.TryGetProperty("mutationId", out var mutationElement) && mutationElement.ValueKind != JsonValueKind.Null)
            Validation.Require(mutationElement.ValueKind == JsonValueKind.String && Guid.TryParse(mutationElement.GetString(), out var parsed) && parsed != Guid.Empty,
                "The mutation identity is invalid.");
        if (mutationElement.ValueKind == JsonValueKind.String) mutationId = Guid.Parse(mutationElement.GetString()!);
        var requestHash = Fingerprint(payload);
        var revision = 0;
        Validation.Require(payload.TryGetProperty("revision", out var revisionElement) && revisionElement.TryGetInt32(out revision),
            "The workout revision is required.", 409);

        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == sessionId, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        var replay = await ReplayWorkoutMutation(sessionId, mutationId, "workout.set.patch", requestHash, ct);
        if (replay is not null)
        {
            await gate.Commit(ct);
            return replay;
        }
        Validation.Require(session!.Active, "This workout is already saved to your history.", 409);
        TemplateService.RequireFresh(revision, session.Revision);
        var set = await db.Sets.SingleOrDefaultAsync(s => s.Id == setId, ct);
        Validation.Require(set != null, "That set no longer exists.", 404);
        var exercise = await db.SessionExercises.SingleOrDefaultAsync(e => e.Id == set!.SessionExerciseId && e.SessionId == sessionId, ct);
        Validation.Require(exercise != null, "That set is not part of this workout.", 409);

        var loadModel = exercise!.LoadModel;
        var resistanceMode = set!.ResistanceMode;
        var weight = set.WeightKg;
        var reps = set.Reps;
        var rpe = set.Rpe;
        var done = set.Done;
        var warmup = set.Warmup;
        if (payload.TryGetProperty("weightKg", out var weightElement)) weight = NullableDouble(weightElement, "Weight");
        if (payload.TryGetProperty("reps", out var repsElement)) reps = NullableInt(repsElement, "Reps");
        if (payload.TryGetProperty("rpe", out var rpeElement)) rpe = NullableDouble(rpeElement, "RPE");
        if (payload.TryGetProperty("done", out var doneElement))
            Validation.Require(doneElement.ValueKind is JsonValueKind.True or JsonValueKind.False, "Done must be true or false.");
        if (doneElement.ValueKind is JsonValueKind.True or JsonValueKind.False) done = doneElement.GetBoolean();
        if (payload.TryGetProperty("warmup", out var warmupElement))
            Validation.Require(warmupElement.ValueKind is JsonValueKind.True or JsonValueKind.False, "Warm-up must be true or false.");
        if (warmupElement.ValueKind is JsonValueKind.True or JsonValueKind.False) warmup = warmupElement.GetBoolean();
        if (payload.TryGetProperty("resistanceMode", out var modeElement))
        {
            Validation.Require(modeElement.ValueKind == JsonValueKind.String, "Resistance mode is invalid.");
            resistanceMode = modeElement.GetString() ?? "";
        }
        resistanceMode = ResolveResistanceMode(loadModel, resistanceMode);
        Validation.LoggedSet(weight, reps, rpe, done, warmup);
        var warmupChanged = warmup != set.Warmup;
        var step = Progression.DefaultStepKg;
        if (exercise.ExerciseId is { } exerciseId)
        {
            var info = await progression.LoadInfo([exerciseId], ct);
            if (info.TryGetValue(exerciseId, out var found)) step = found.StepKg;
        }
        weight = NormalizeEnteredLoad(loadModel, resistanceMode, weight, step);
        var changed = weight != set.WeightKg || reps != set.Reps || rpe != set.Rpe || done != set.Done ||
            warmup != set.Warmup || !string.Equals(resistanceMode, set.ResistanceMode, StringComparison.Ordinal);
        if (changed)
        {
            set.WeightKg = weight; set.Reps = reps; set.Rpe = rpe; set.Done = done; set.Warmup = warmup;
            set.ResistanceMode = resistanceMode; set.SystemLoadKg = ComputeSystemLoad(session, loadModel, resistanceMode, weight);
            if (warmupChanged)
            {
                var ordered = await db.Sets.Where(row => row.SessionExerciseId == exercise.Id).OrderBy(row => row.Position).ToListAsync(ct);
                var ordinal = 0;
                foreach (var row in ordered) row.WorkingSetOrdinal = row.Warmup ? null : ++ordinal;
            }
            set.Revision++; session.Revision++;
        }
        if (changed || mutationId is not null)
        {
            await RecordWorkoutMutation(mutationId, sessionId, "workout.set.patch", requestHash, ct);
            await db.SaveChangesAsync(ct);
        }
        await gate.Commit(ct);
        return await Get(sessionId, ct);
    }

    private static double? NullableDouble(JsonElement value, string label)
    {
        if (value.ValueKind == JsonValueKind.Null) return null;
        Validation.Require(value.TryGetDouble(out var number), $"{label} is invalid.");
        return number;
    }

    private static int? NullableInt(JsonElement value, string label)
    {
        if (value.ValueKind == JsonValueKind.Null) return null;
        Validation.Require(value.TryGetInt32(out var number), $"{label} is invalid.");
        return number;
    }
}
