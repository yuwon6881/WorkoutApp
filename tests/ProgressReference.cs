using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
namespace Workout.Tests;
// Frozen pre-optimization calculator for parity testing.
internal static class ProgressReference
{
    public static async Task<object> Build(AppDb db, CancellationToken ct)
    {
        var sessions = await db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null).OrderByDescending(w => w.FinishedAt).ToListAsync(ct);
        var ids = sessions.Select(s => s.Id).ToList();
        var exercises = await db.SessionExercises.AsNoTracking().Where(e => ids.Contains(e.SessionId)).ToListAsync(ct);
        var exerciseIds = exercises.Select(e => e.Id).ToList();
        var sets = await db.Sets.AsNoTracking().Where(s => exerciseIds.Contains(s.SessionExerciseId) && s.Done && !s.Warmup).ToListAsync(ct);
        var states = await db.Progress.AsNoTracking().ToListAsync(ct);
        var sessionById = sessions.ToDictionary(s => s.Id);
        var exerciseById = exercises.ToDictionary(exercise => exercise.Id);
        var setsByExerciseId = sets.GroupBy(set => set.SessionExerciseId)
            .ToDictionary(group => group.Key, group => group.ToList());
        var volumeRows = sets.Select(set =>
        {
            var exercise = exerciseById[set.SessionExerciseId];
            var load = exercise.LoadModel == LoadModels.FullBodyweight ? set.SystemLoadKg : exercise.LoadModel == LoadModels.External ? set.WeightKg : null;
            return new { Set = set, Exercise = exercise, Load = load };
        }).Where(row => row.Load is not null && row.Set.Reps is not null).ToList();
        var totalVolume = volumeRows.Sum(row => row.Load!.Value * row.Set.Reps!.Value);
        var recentCutoff = DateTime.UtcNow.Date.AddDays(-6);
        var recentSessions = sessions.Where(session => (session.FinishedAt ?? session.StartedAt) >= recentCutoff).ToList();
        var recentIds = recentSessions.Select(x => x.Id).ToHashSet();
        var recentExerciseIds = exercises.Where(x => recentIds.Contains(x.SessionId)).Select(x => x.Id).ToHashSet();
        var recentWorkingSets = sets.Where(x => recentExerciseIds.Contains(x.SessionExerciseId)).ToList();
        var recentSets = volumeRows.Where(x => recentExerciseIds.Contains(x.Set.SessionExerciseId)).ToList();
        var trainingMinutes = sessions.Sum(session =>
        {
            var endedAt = session.FinishedAt ?? DateTime.UtcNow;
            var pausedSeconds = session.PausedSeconds + (session.PausedAt is { } pausedAt
                ? Math.Max(0, (long)Math.Round((endedAt - pausedAt).TotalSeconds))
                : 0);
            var activeMinutes = ((endedAt - session.StartedAt).TotalSeconds - pausedSeconds) / 60;
            return Math.Max(1, (int)Math.Round(Math.Max(0, activeMinutes)));
        });
        var best = exercises.GroupBy(e => new { e.ExerciseId, e.NameSnapshot }).Select(group =>
        {
            var logged = new List<(SessionExercise Exercise, CompletedSet Set, WorkoutSession Session)>();
            foreach (var exercise in group)
                if (setsByExerciseId.TryGetValue(exercise.Id, out var exerciseSets))
                    foreach (var set in exerciseSets)
                        logged.Add((exercise, set, sessionById[exercise.SessionId]));
            // An unknown load cannot be a heaviest set; it is left out rather than counted as zero.
            var external = logged.Where(row => row.Exercise.LoadModel == LoadModels.External && row.Set.WeightKg != null).ToList();
            var heaviest = external.Select(row => new { row.Set.WeightKg, row.Set.Reps })
                .OrderByDescending(row => row.WeightKg).ThenByDescending(row => row.Reps).FirstOrDefault();
            var fullBodyweight = logged.Where(row => row.Exercise.LoadModel == LoadModels.FullBodyweight).ToList();
            var systemLoads = fullBodyweight.Where(row => row.Set.SystemLoadKg is not null).Select(row => row.Set.SystemLoadKg!.Value).ToList();
            var addedLoads = fullBodyweight.Where(row => row.Set.ResistanceMode == ResistanceModes.Added && row.Set.WeightKg is not null)
                .Select(row => row.Set.WeightKg!.Value).ToList();
            var assistanceLoads = fullBodyweight.Where(row => row.Set.ResistanceMode == ResistanceModes.Assistance && row.Set.WeightKg is not null)
                .Select(row => row.Set.WeightKg!.Value).ToList();
            var systemEstimateRows = fullBodyweight.Select(row => new { row.Session.FinishedAt, Estimate = Progression.E1rm(row.Set.SystemLoadKg, row.Set.Reps, row.Set.Rpe) })
                .Where(row => row.Estimate is not null).ToList();
            var systemEstimates = systemEstimateRows.Select(row => row.Estimate!.Value).ToList();
            var latestSystemEstimate = systemEstimateRows.OrderByDescending(row => row.FinishedAt).FirstOrDefault()?.Estimate;
            var relativeEstimates = fullBodyweight.Select(row =>
            {
                var snapshot = ReadBodyWeight(row.Session);
                var estimate = Progression.E1rm(row.Set.SystemLoadKg, row.Set.Reps, row.Set.Rpe);
                if (estimate is not { } value || snapshot?.ReferenceKg is not { } reference || reference <= 0) return null;
                return (double?)(value / reference);
            }).OfType<double>().ToList();
            var repRows = logged.Where(row => row.Set.Reps is not null).ToList();
            var bodyweightRep = logged.Where(row => row.Exercise.LoadModel == LoadModels.BodyweightContextOnly && row.Set.Reps is not null)
                .Select(row => new { row.Set.Reps, Snapshot = ReadBodyWeight(row.Session) })
                .Where(row => row.Snapshot?.ReferenceKg is not null)
                .OrderByDescending(row => row.Reps).ThenByDescending(row => row.Snapshot!.ReferenceKg).FirstOrDefault();
            var key = ProgressionService.Key(group.Key.ExerciseId, group.Key.NameSnapshot);
            var state = states.FirstOrDefault(s => s.ExerciseId == key.ExerciseId && s.NameKey == key.NameKey);
            return new
            {
                exerciseId = group.Key.ExerciseId,
                exercise = group.Key.NameSnapshot,
                sessions = group.Select(e => e.SessionId).Distinct().Count(),
                heaviestKg = heaviest?.WeightKg,
                heaviestReps = heaviest?.Reps,
                volumeKg = external.Count == 0 ? (double?)null : external.Sum(row => row.Set.WeightKg!.Value * row.Set.Reps!.GetValueOrDefault()),
                // Estimates exist only where sets could support one, so they stay absent rather
                // than appearing as a confident zero.
                estimatedMaxKg = fullBodyweight.Count > 0 ? (systemEstimates.Count == 0 ? (double?)null : systemEstimates.Max()) : external.Count > 0 ? state?.TrendE1rmKg : null,
                lastEstimatedMaxKg = fullBodyweight.Count > 0 ? latestSystemEstimate : external.Count > 0 ? state?.LastE1rmKg : null,
                externalLoadPrKg = external.Count == 0 ? (double?)null : external.Max(row => row.Set.WeightKg!.Value),
                addedLoadPrKg = addedLoads.Count == 0 ? (double?)null : addedLoads.Max(),
                assistanceReductionPrKg = assistanceLoads.Count == 0 ? (double?)null : assistanceLoads.Min(),
                systemLoadPrKg = systemLoads.Count == 0 ? (double?)null : systemLoads.Max(),
                repPr = repRows.Count == 0 ? (int?)null : repRows.Max(row => row.Set.Reps!.Value),
                estimatedSystemLoadMaxKg = systemEstimates.Count == 0 ? (double?)null : systemEstimates.Max(),
                relativeStrength = relativeEstimates.Count == 0 ? (double?)null : relativeEstimates.Max(),
                bodyweightRepRecord = bodyweightRep is null ? null : new { reps = bodyweightRep.Reps, bodyweightKg = bodyweightRep.Snapshot!.ReferenceKg }
            };
        }).OrderByDescending(x => x.sessions).ToList();
        var result = new
        {
            sessions = sessions.Count,
            exercises = best,
            totalVolumeKg = totalVolume == 0 && !sets.Any(set => set.WeightKg == 0) ? (double?)null : totalVolume,
            workingSets = sets.Count,
            trainingMinutes,
            weekSessions = recentSessions.Count,
            weekVolumeKg = recentSets.Count == 0 ? (double?)null : recentSets.Sum(row => row.Load!.Value * row.Set.Reps!.Value),
            weekWorkingSets = recentWorkingSets.Count
        };
        return result;
    }
    private static BodyWeightSnapshot? ReadBodyWeight(WorkoutSession session)
    {
        if (string.IsNullOrWhiteSpace(session.BodyWeightSnapshotJson)) return null;
        try { return Json.Read<BodyWeightSnapshot>(session.BodyWeightSnapshotJson); }
        catch (DomainException) { return null; }
    }
}
