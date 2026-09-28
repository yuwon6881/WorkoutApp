using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

// Rebuilds hold one source batch and one aggregate per exercise, never all completed sets.
internal sealed class ProgressAccumulator(IReadOnlyList<ExerciseProgress> states, DateTime recentCutoff)
{
    private readonly Dictionary<(Guid?, string), ExerciseAggregate> exercises = [];
    private int sessions, workingSets, trainingMinutes, weekSessions, weekWorkingSets;
    private double totalVolume, weekVolume;
    private bool hasZeroWeight, hasWeekVolume;

    public void Add(IReadOnlyList<WorkoutSession> batch, IReadOnlyList<SessionExercise> rows, IReadOnlyList<CompletedSet> sets)
    {
        var sessionsById = batch.ToDictionary(x => x.Id);
        var setsByExercise = sets.ToLookup(x => x.SessionExerciseId);
        sessions += batch.Count;
        foreach (var session in batch)
        {
            var ended = session.FinishedAt!.Value;
            var paused = session.PausedSeconds + (session.PausedAt is { } at ? Math.Max(0, (long)Math.Round((ended - at).TotalSeconds)) : 0);
            trainingMinutes += Math.Max(1, (int)Math.Round(Math.Max(0, (ended - session.StartedAt).TotalSeconds - paused) / 60));
            if (ended >= recentCutoff) weekSessions++;
        }
        foreach (var group in rows.GroupBy(x => (x.ExerciseId, x.NameSnapshot)))
        {
            if (!exercises.TryGetValue(group.Key, out var aggregate))
                exercises[group.Key] = aggregate = new ExerciseAggregate(group.Key.ExerciseId, group.Key.NameSnapshot);
            aggregate.Sessions += group.Select(x => x.SessionId).Distinct().Count();
            foreach (var exercise in group)
            {
                var session = sessionsById[exercise.SessionId];
                var recent = session.FinishedAt >= recentCutoff;
                BodyWeightSnapshot? bodyweight = null;
                if (!string.IsNullOrWhiteSpace(session.BodyWeightSnapshotJson))
                    try { bodyweight = Json.Read<BodyWeightSnapshot>(session.BodyWeightSnapshotJson); } catch (DomainException) { }
                foreach (var set in setsByExercise[exercise.Id])
                {
                    workingSets++;
                    hasZeroWeight |= set.WeightKg == 0;
                    if (recent) weekWorkingSets++;
                    var load = exercise.LoadModel == LoadModels.FullBodyweight ? set.SystemLoadKg
                        : exercise.LoadModel == LoadModels.External ? set.WeightKg : null;
                    if (load is { } value && set.Reps is { } reps)
                    {
                        var volume = value * reps;
                        totalVolume += volume;
                        if (recent) { hasWeekVolume = true; weekVolume += volume; }
                    }
                    aggregate.Add(exercise, set, session.FinishedAt!.Value, bodyweight);
                }
            }
        }
    }

    public object Result() => new
    {
        sessions,
        exercises = exercises.Values.OrderByDescending(x => x.Sessions).Select(x => x.Result(states)).ToList(),
        totalVolumeKg = totalVolume == 0 && !hasZeroWeight ? (double?)null : totalVolume,
        workingSets, trainingMinutes, weekSessions,
        weekVolumeKg = hasWeekVolume ? (double?)weekVolume : null,
        weekWorkingSets
    };

    private sealed class ExerciseAggregate(Guid? id, string name)
    {
        public int Sessions;
        private int externalCount, bodyweightCount;
        private double externalVolume;
        private double? heaviest, added, assistance, system, estimate, latestEstimate, relative;
        private int? heaviestReps, repPr, bodyweightReps;
        private double? bodyweightKg;
        private DateTime? latestEstimateAt;

        public void Add(SessionExercise exercise, CompletedSet set, DateTime finished, BodyWeightSnapshot? snapshot)
        {
            if (set.Reps is { } reps) repPr = Math.Max(repPr ?? reps, reps);
            if (exercise.LoadModel == LoadModels.External && set.WeightKg is { } load)
            {
                externalCount++;
                externalVolume += load * set.Reps.GetValueOrDefault();
                if (heaviest == null || load > heaviest || load == heaviest && (set.Reps ?? int.MinValue) > (heaviestReps ?? int.MinValue))
                { heaviest = load; heaviestReps = set.Reps; }
            }
            if (exercise.LoadModel == LoadModels.FullBodyweight)
            {
                bodyweightCount++;
                if (set.SystemLoadKg is { } systemLoad) system = Math.Max(system ?? systemLoad, systemLoad);
                if (set.WeightKg is { } weight && set.ResistanceMode == ResistanceModes.Added) added = Math.Max(added ?? weight, weight);
                if (set.WeightKg is { } reduction && set.ResistanceMode == ResistanceModes.Assistance) assistance = Math.Min(assistance ?? reduction, reduction);
                if (Progression.E1rm(set.SystemLoadKg, set.Reps, set.Rpe) is { } strength)
                {
                    estimate = Math.Max(estimate ?? strength, strength);
                    if (latestEstimateAt == null || finished > latestEstimateAt) { latestEstimateAt = finished; latestEstimate = strength; }
                    if (snapshot?.ReferenceKg is { } reference && reference > 0)
                        relative = Math.Max(relative ?? strength / reference, strength / reference);
                }
            }
            if (exercise.LoadModel == LoadModels.BodyweightContextOnly && set.Reps is { } count && snapshot?.ReferenceKg is { } kg
                && (bodyweightReps == null || count > bodyweightReps || count == bodyweightReps && kg > bodyweightKg))
            { bodyweightReps = count; bodyweightKg = kg; }
        }

        public object Result(IReadOnlyList<ExerciseProgress> states)
        {
            var key = ProgressionService.Key(id, name);
            var state = states.FirstOrDefault(x => x.ExerciseId == key.ExerciseId && x.NameKey == key.NameKey);
            return new
            {
                exerciseId = id, exercise = name, sessions = Sessions,
                heaviestKg = heaviest, heaviestReps, volumeKg = externalCount == 0 ? (double?)null : externalVolume,
                estimatedMaxKg = bodyweightCount > 0 ? estimate : externalCount > 0 ? state?.TrendE1rmKg : null,
                lastEstimatedMaxKg = bodyweightCount > 0 ? latestEstimate : externalCount > 0 ? state?.LastE1rmKg : null,
                externalLoadPrKg = heaviest, addedLoadPrKg = added, assistanceReductionPrKg = assistance, systemLoadPrKg = system,
                repPr, estimatedSystemLoadMaxKg = estimate, relativeStrength = relative,
                bodyweightRepRecord = bodyweightReps == null ? null : new { reps = bodyweightReps, bodyweightKg }
            };
        }
    }
}
