using System.Globalization;
using Workout.Api.Domain;

namespace Workout.Api.Services;

internal sealed record WorkoutRepExposure(
    Guid SessionId,
    DateTime FinishedAt,
    DateTime StartedAt,
    (Guid, string) ExerciseKey,
    Guid SessionExerciseId,
    Guid SetId,
    int Position,
    string LoadModel,
    string ResistanceMode,
    double? WeightKg,
    double? SystemLoadKg,
    int? Reps);

internal sealed record RepPrLoadKey(string LoadModel, string ResistanceMode, string Value, double? LoadKg);

public sealed record WorkoutRepPrResult(
    Dictionary<Guid, (bool IsPr, string? Kind, int? Reps)> Exercises,
    Dictionary<Guid, (bool IsPr, string? Kind, int? Reps)> Sets,
    Dictionary<Guid, int> SessionCounts,
    Dictionary<(Guid, string), List<PreviousRepRecord>> PreviousByExercise);

internal static class WorkoutRepPrBuilder
{
    public static RepPrLoadKey? LoadKey(string loadModel, string resistanceMode, double? weightKg, double? systemLoadKg)
    {
        if (loadModel == LoadModels.FullBodyweight)
        {
            if (systemLoadKg is not { } system) return null;
            var canonical = Math.Round(system, 4);
            return new(loadModel, resistanceMode, canonical.ToString("0.####", CultureInfo.InvariantCulture), canonical);
        }

        if (loadModel is LoadModels.RepsOnly or LoadModels.BodyweightContextOnly)
            return new(loadModel, resistanceMode, "reps_only", null);

        if (weightKg is not { } weight) return null;
        var canonicalWeight = Math.Round(weight, 4);
        return new(loadModel, resistanceMode, canonicalWeight.ToString("0.####", CultureInfo.InvariantCulture), canonicalWeight);
    }

    public static WorkoutRepPrResult Build(IEnumerable<WorkoutRepExposure> exposures, IReadOnlyList<WorkoutRepBaseline>? baseline = null)
    {
        var exercises = new Dictionary<Guid, (bool IsPr, string? Kind, int? Reps)>();
        var sets = new Dictionary<Guid, (bool IsPr, string? Kind, int? Reps)>();
        var sessionCounts = new Dictionary<Guid, int>();
        var running = new Dictionary<((Guid, string) Exercise, string LoadModel, string ResistanceMode, string Load), int>();

        foreach (var item in baseline ?? [])
            foreach (var record in item.Records)
                if (LoadKey(record.LoadModel, record.ResistanceMode, record.LoadKg, record.LoadKg) is { } load)
                    running[((item.ExerciseId, item.Name), load.LoadModel, load.ResistanceMode, load.Value)] = record.Reps;

        var sessions = exposures.GroupBy(x => new { x.SessionId, x.FinishedAt, x.StartedAt })
            .OrderBy(x => x.Key.FinishedAt).ThenBy(x => x.Key.StartedAt).ThenBy(x => x.Key.SessionId);
        foreach (var session in sessions)
        {
            var sessionCount = 0;
            foreach (var exercise in session.GroupBy(x => x.ExerciseKey))
            {
                var setPrs = new Dictionary<Guid, int>();
                var sessionMaxima = new Dictionary<(string LoadModel, string ResistanceMode, string Load), int>();

                foreach (var set in exercise.OrderBy(x => x.Position))
                {
                    if (set.Reps is not > 0 || LoadKey(set.LoadModel, set.ResistanceMode, set.WeightKg, set.SystemLoadKg) is not { } load)
                        continue;

                    var recordKey = (exercise.Key, load.LoadModel, load.ResistanceMode, load.Value);
                    var hadPrevious = running.TryGetValue(recordKey, out var previous);
                    var loadKey = (load.LoadModel, load.ResistanceMode, load.Value);
                    var highest = Math.Max(hadPrevious ? previous : 0, sessionMaxima.GetValueOrDefault(loadKey));
                    if (hadPrevious && set.Reps.Value > highest)
                    {
                        setPrs[set.SetId] = set.Reps.Value;
                    }

                    sessionMaxima[loadKey] = Math.Max(sessionMaxima.GetValueOrDefault(loadKey), set.Reps.Value);
                }

                foreach (var (key, reps) in sessionMaxima)
                {
                    var recordKey = (exercise.Key, key.LoadModel, key.ResistanceMode, key.Load);
                    running[recordKey] = Math.Max(running.GetValueOrDefault(recordKey), reps);
                }

                var isPr = setPrs.Count > 0;
                if (isPr) sessionCount++;
                var exerciseId = exercise.First().SessionExerciseId;
                var kind = isPr ? "reps" : null;
                exercises[exerciseId] = (isPr, kind, isPr ? setPrs.Values.Max() : null);
                foreach (var set in exercise)
                {
                    var isSetPr = setPrs.TryGetValue(set.SetId, out var reps);
                    sets[set.SetId] = (isSetPr, isSetPr ? "reps" : null, isSetPr ? reps : null);
                }
            }
            sessionCounts[session.Key.SessionId] = sessionCount;
        }

        var previousByExercise = new Dictionary<(Guid, string), List<PreviousRepRecord>>();
        foreach (var (key, reps) in running)
        {
            if (!previousByExercise.TryGetValue(key.Exercise, out var records))
                previousByExercise[key.Exercise] = records = [];
            double? loadKg = key.Load == "reps_only" ? null : double.Parse(key.Load, CultureInfo.InvariantCulture);
            records.Add(new PreviousRepRecord(key.LoadModel, key.ResistanceMode, loadKg, reps));
        }

        return new(exercises, sets, sessionCounts, previousByExercise);
    }
}
