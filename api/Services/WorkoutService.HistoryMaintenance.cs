using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class WorkoutService
{
    private async Task RebuildProgress(List<SessionExercise> removed, CancellationToken ct)
    {
        var keys = removed.Select(e => ProgressionService.Key(e.ExerciseId, e.NameSnapshot)).ToHashSet();
        var ids = keys.Select(k => k.ExerciseId).ToList();
        var progress = await db.Progress.Where(p => ids.Contains(p.ExerciseId)).ToListAsync(ct);
        db.Progress.RemoveRange(progress.Where(p => keys.Contains((p.ExerciseId, p.NameKey))));
        await db.SaveChangesAsync(ct);
        var rebuilt = new Dictionary<(Guid ExerciseId, string NameKey), ProgressionState>();
        // Rebuild in chronological batches inside the deletion transaction. A removed exposure
        // must no longer contribute to either the last estimate or its smoothed trend.
        var sessions = await db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null &&
            db.SessionExercises.Any(e => e.SessionId == w.Id && (e.ExerciseId == null || ids.Contains(e.ExerciseId.Value))))
            .OrderBy(w => w.FinishedAt).ThenBy(w => w.Id).Select(w => w.Id).ToListAsync(ct);
        foreach (var batch in sessions.Chunk(64))
        {
            var rows = await db.SessionExercises.AsNoTracking().Where(e => batch.Contains(e.SessionId) &&
                (e.ExerciseId == null || ids.Contains(e.ExerciseId.Value))).ToListAsync(ct);
            rows = rows.Where(e => keys.Contains(ProgressionService.Key(e.ExerciseId, e.NameSnapshot))).ToList();
            var rowIds = rows.Select(e => e.Id).ToList();
            var sets = await db.Sets.AsNoTracking().Where(s => rowIds.Contains(s.SessionExerciseId) && s.Done && !s.Warmup && s.DurationSeconds == null).ToListAsync(ct);
            foreach (var sessionId in batch)
            {
                foreach (var exercise in rows.Where(e => e.SessionId == sessionId).OrderBy(e => e.Position))
                {
                    var techniques = SetTechniques.ByPosition(exercise.PrescriptionJson);
                    var evidence = sets.Where(s => s.SessionExerciseId == exercise.Id &&
                        SetTechniques.IsStrengthEvidence(techniques, s.Position)).OrderBy(s => s.Position)
                        .Select(s => new PreviousSet(LoadModels.ComparableLoad(exercise.LoadModel, s.WeightKg, s.SystemLoadKg),
                            s.Reps, s.Rpe ?? Progression.RpeFromRir(s.Rir))).ToList();
                    var estimate = Progression.SessionE1rm(evidence);
                    if (estimate is null) continue;
                    var key = ProgressionService.Key(exercise.ExerciseId, exercise.NameSnapshot);
                    rebuilt.TryGetValue(key, out var previous);
                    rebuilt[key] = Progression.Advance(previous, estimate.Value);
                }
            }
        }
        db.Progress.AddRange(rebuilt.Select(item => new ExerciseProgress
        {
            UserId = db.CurrentUser!.Value, ExerciseId = item.Key.ExerciseId, NameKey = item.Key.NameKey,
            TrendE1rmKg = item.Value.TrendE1rmKg, LastE1rmKg = item.Value.LastE1rmKg, Stalls = item.Value.Stalls,
            Revision = 1
        }));
        await db.SaveChangesAsync(ct);
    }
}
