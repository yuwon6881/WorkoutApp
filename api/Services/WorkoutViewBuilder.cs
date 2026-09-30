using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public static class WorkoutViewBuilder
{
    public static async Task<Dictionary<Guid, SessionView>> BuildViews(
        AppDb db,
        IReadOnlyList<WorkoutSession> sessions,
        IReadOnlyList<SessionExercise> exercises,
        IReadOnlyList<CompletedSet> sets,
        CancellationToken ct)
    {
        if (sessions.Count == 0) return [];

        var exercisesBySession = exercises.GroupBy(e => e.SessionId).ToDictionary(g => g.Key, g => g.ToList());
        var setsByExercise = sets.GroupBy(s => s.SessionExerciseId).ToDictionary(g => g.Key, g => g.ToList());

        var (exercisePrs, setPrs, sessionPrCounts, bests, repBests) = await WorkoutPrReadService.Get(db, sessions, ct);
        var trackingModes = await CatalogService.TrackingModesFor(db, exercises.Select(e => e.ExerciseId), ct);

        return sessions.ToDictionary(session => session.Id, session => BuildView(session,
            exercisesBySession.GetValueOrDefault(session.Id) ?? [], setsByExercise, exercisePrs, setPrs,
            sessionPrCounts.GetValueOrDefault(session.Id, 0), session.Active ? bests : null,
            session.Active ? repBests.PreviousByExercise : null, trackingModes));
    }

    public static async Task<(Dictionary<Guid, (bool IsPr, double? PrE1rmKg, string? PrKind, int? PrReps)> ExercisePrs,
        Dictionary<Guid, (bool IsPr, double? Estimated1RmKg, string? PrKind, int? PrReps)> SetPrs,
        Dictionary<Guid, int> SessionPrCounts,
        Dictionary<(Guid, string), double> Bests,
        WorkoutRepPrResult RepBests)> ComputePrs(
        AppDb db,
        IReadOnlyList<WorkoutSession> requestedSessions,
        CancellationToken ct, WorkoutPrBaseline? baseline = null)
    {
        var exercisePrs = new Dictionary<Guid, (bool IsPr, double? PrE1rmKg, string? PrKind, int? PrReps)>();
        var setPrs = new Dictionary<Guid, (bool IsPr, double? Estimated1RmKg, string? PrKind, int? PrReps)>();
        var sessionPrCounts = new Dictionary<Guid, int>();

        var user = db.CurrentUser;
        var runningBest = baseline?.Strength.ToDictionary(x => (x.ExerciseId, x.Name), x => x.Value) ?? new Dictionary<(Guid, string), double>();
        var emptyRepBests = WorkoutRepPrBuilder.Build([]);
        if (user == null || requestedSessions.Count == 0)
            return (exercisePrs, setPrs, sessionPrCounts, runningBest, emptyRepBests);

        var requestedIds = requestedSessions.Select(x => x.Id).ToList();
        var useBatch = baseline != null;
        var allDoneSets = await (from s in db.Sets.AsNoTracking()
                                 join e in db.SessionExercises.AsNoTracking() on s.SessionExerciseId equals e.Id
                                 join w in db.Workouts.AsNoTracking() on e.SessionId equals w.Id
                                 where w.UserId == user && w.FinishedAt != null && s.Done && !s.Warmup
                                     && (!useBatch || requestedIds.Contains(w.Id))
                                 select new
                                 {
                                     SessionId = w.Id,
                                     w.FinishedAt,
                                     w.StartedAt,
                                     ExerciseId = e.ExerciseId,
                                     e.NameSnapshot,
                                     e.LoadModel,
                                     s.ResistanceMode,
                                     SessionExerciseId = e.Id,
                                     SetId = s.Id,
                                     s.Position,
                                     s.WeightKg,
                                     s.SystemLoadKg,
                                     s.Reps,
                                     s.Rpe
                                 }).ToListAsync(ct);

        var repBests = WorkoutRepPrBuilder.Build(allDoneSets.Select(x => new WorkoutRepExposure(
            x.SessionId, x.FinishedAt!.Value, x.StartedAt, PrKey(x.ExerciseId, x.NameSnapshot), x.SessionExerciseId,
            x.SetId, x.Position, x.LoadModel, x.ResistanceMode, x.WeightKg, x.SystemLoadKg, x.Reps)), baseline?.Reps);
        var sessionsChronological = allDoneSets
            .GroupBy(x => new { x.SessionId, x.FinishedAt, x.StartedAt })
            .OrderBy(g => g.Key.FinishedAt)
            .ThenBy(g => g.Key.StartedAt)
            .ThenBy(g => g.Key.SessionId)
            .ToList();

        foreach (var sessionGroup in sessionsChronological)
        {
            var sId = sessionGroup.Key.SessionId;
            var prCount = repBests.SessionCounts.GetValueOrDefault(sId);

            var exerciseGroups = sessionGroup.GroupBy(x => PrKey(x.ExerciseId, x.NameSnapshot));
            foreach (var exGroup in exerciseGroups)
            {
                var key = exGroup.Key;
                runningBest.TryGetValue(key, out var previousBest);
                var hadPrevious = runningBest.ContainsKey(key);

                double sessionMax = 0;
                Guid? bestSetId = null;
                var setEstimates = new Dictionary<Guid, double>();

                foreach (var s in exGroup)
                {
                    var load = s.LoadModel == LoadModels.FullBodyweight ? (s.SystemLoadKg ?? s.WeightKg) : s.WeightKg;
                    var estimate = Progression.Estimate1Rm(load, s.Reps, s.Rpe);
                    if (estimate is { } eVal)
                    {
                        setEstimates[s.SetId] = eVal;
                        if (eVal > sessionMax)
                        {
                            sessionMax = eVal;
                            bestSetId = s.SetId;
                        }
                    }
                }

                var isE1rmPr = false;
                if (sessionMax > 0)
                {
                    if (hadPrevious && sessionMax > previousBest + 1e-4)
                    {
                        isE1rmPr = true;
                        runningBest[key] = sessionMax;
                    }
                    else if (!hadPrevious)
                    {
                        runningBest[key] = sessionMax;
                    }
                }

                var (isRepPr, repPrKind, maxPrReps) = repBests.Exercises.GetValueOrDefault(
                    exGroup.First().SessionExerciseId, (false, null, null));

                var isExPr = isE1rmPr || isRepPr;
                if (isE1rmPr && !isRepPr) prCount++;

                var sessionExerciseId = exGroup.First().SessionExerciseId;
                string? exPrKind = (isE1rmPr, isRepPr) switch
                {
                    (true, true) => "both",
                    (true, false) => "e1rm",
                    (false, true) => repPrKind,
                    _ => null
                };

                exercisePrs[sessionExerciseId] = (isExPr, sessionMax > 0 ? sessionMax : null, exPrKind, maxPrReps);

                foreach (var s in exGroup)
                {
                    var setE1rm = setEstimates.GetValueOrDefault(s.SetId);
                    var isSetE1rm = isE1rmPr && bestSetId == s.SetId;
                    var (isSetRep, setRepKind, setRepsVal) = repBests.Sets.GetValueOrDefault(s.SetId, (false, null, null));
                    var isSetPr = isSetE1rm || isSetRep;
                    string? setPrKind = (isSetE1rm, isSetRep) switch
                    {
                        (true, true) => "both",
                        (true, false) => "e1rm",
                        (false, true) => setRepKind,
                        _ => null
                    };

                    setPrs[s.SetId] = (isSetPr, setE1rm > 0 ? setE1rm : null, setPrKind, isSetRep ? setRepsVal : null);
                }
            }
            sessionPrCounts[sId] = prCount;
        }

        return (exercisePrs, setPrs, sessionPrCounts, runningBest, repBests);
    }

    public static (Guid, string) PrKey(Guid? exerciseId, string nameSnapshot) => (exerciseId ?? Guid.Empty, CatalogService.Normalize(nameSnapshot));

    public static SessionView BuildView(
        WorkoutSession session,
        IReadOnlyList<SessionExercise> exercises,
        IReadOnlyDictionary<Guid, List<CompletedSet>> setsByExercise,
        IReadOnlyDictionary<Guid, (bool IsPr, double? PrE1rmKg, string? PrKind, int? PrReps)> exercisePrs,
        IReadOnlyDictionary<Guid, (bool IsPr, double? Estimated1RmKg, string? PrKind, int? PrReps)> setPrs,
        int sessionPrCount = 0,
        IReadOnlyDictionary<(Guid, string), double>? previousBests = null,
        IReadOnlyDictionary<(Guid, string), List<PreviousRepRecord>>? previousRepRecords = null,
        IReadOnlyDictionary<Guid, string>? trackingModes = null)
    {
        var sets = exercises.SelectMany(e => setsByExercise.GetValueOrDefault(e.Id) ?? []).ToList();
        var done = sets.Where(s => s.Done).ToList();
        var workingDone = done.Where(s => !s.Warmup).ToList();
        var warmupDone = done.Where(s => s.Warmup).ToList();
        var loadModels = exercises.ToDictionary(e => e.Id, e => e.LoadModel);
        // Timed sets carry no reps, so they have no volume; a weighted hold must not break the sum.
        var external = workingDone.Where(s => s.WeightKg != null && s.Reps != null && s.SystemLoadKg == null &&
            loadModels.GetValueOrDefault(s.SessionExerciseId, LoadModels.External) == LoadModels.External).ToList();
        var system = workingDone.Where(s => s.SystemLoadKg != null && s.Reps != null).ToList();
        var bodyWeight = ReadOptional<BodyWeightSnapshot>(session.BodyWeightSnapshotJson);
        var context = ReadOptional<NutritionTrainingContext>(session.NutritionContextJson);
        var restStatus = session.RestStatus switch
        {
            WorkoutRestStatus.Running when session.RestDeadlineUtc <= DateTime.UtcNow => WorkoutRestStatus.Elapsed,
            var status when !string.IsNullOrWhiteSpace(status) => status,
            _ => WorkoutRestStatus.Idle
        };
        var restView = new SessionRestView(
            session.RestGeneration,
            restStatus,
            session.RestDeadlineUtc,
            session.RestPausedRemainingMs,
            session.RestDurationMs,
            session.RestOriginDeviceId);
        return new SessionView(session.Id, session.TemplateId, session.ProgramId, session.Name, session.Note, session.Active,
            session.StartedAt, session.FinishedAt, session.Revision,
            exercises.Select(e =>
            {
                var exerciseSets = setsByExercise.GetValueOrDefault(e.Id) ?? [];
                var canRestore = e.IsReplacement && !string.IsNullOrEmpty(e.BaselineJson) && !exerciseSets.Any(s => s.Done);
                var (isExPr, prE1rmKg, exPrKind, exPrReps) = exercisePrs.GetValueOrDefault(e.Id, (false, null, null, null));
                var key = PrKey(e.ExerciseId, e.NameSnapshot);
                var repRecords = previousRepRecords != null && previousRepRecords.TryGetValue(key, out var priorRecords)
                    ? priorRecords : null;
                return new SessionExerciseView(e.Id, e.ExerciseId, e.NameSnapshot, e.Position, e.Note,
                    Json.Read<List<SetPrescription>>(e.PrescriptionJson),
                    exerciseSets.Select(s =>
                    {
                        var (isSetPr, setE1rmKg, setPrKind, setPrReps) = setPrs.GetValueOrDefault(s.Id, (false, null, null, null));
                        return new SetView(s.Id, s.Position, s.WeightKg, s.Reps, s.Rpe, s.Done, s.Warmup,
                            s.WorkingSetOrdinal, s.ResistanceMode, s.SystemLoadKg, ReadOptional<SetProgressionSuggestion>(s.SuggestionJson),
                            isSetPr, setE1rmKg, s.Rir, setPrKind, setPrReps, s.DurationSeconds);
                    }).ToList(),
                    e.SequenceGroup, Json.Read<List<string>>(e.SubstitutionsJson),
                    ReadOptional<ProgressionView>(e.ProgressionJson), e.LoadModel, e.SourceTemplateExerciseId, e.SourceSlotKey, e.SourcePhaseId,
                    e.SwapGroupKey, e.IsReplacement, e.OriginalExerciseId, e.OriginalNameSnapshot, e.SourcePage, canRestore, e.RestSeconds,
                    e.DemoUrl is { Length: > 0 } demoUrl ? demoUrl : null,
                    isExPr, prE1rmKg,
                    previousBests != null && previousBests.TryGetValue(key, out var previousBest) ? previousBest : null,
                    exPrKind, exPrReps,
                    repRecords is null ? null : LegacyRepBests(repRecords), repRecords,
                    e.ExerciseId is { } trackedId && trackingModes?.GetValueOrDefault(trackedId) is { } mode ? mode : TrackingModes.Reps);
            }).ToList(),
            external.Count == 0 ? null : external.Sum(s => s.WeightKg!.Value * s.Reps!.Value),
            workingDone.Count, warmupDone.Count, bodyWeight, context,
            system.Count == 0 ? null : system.Sum(s => s.SystemLoadKg!.Value * s.Reps!.Value), session.PausedAt, session.PausedSeconds,
            sessionPrCount, restView);
    }

    private static Dictionary<string, int> LegacyRepBests(IEnumerable<PreviousRepRecord> records)
        => records.GroupBy(record => record.LoadKg?.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) ?? "reps_only")
            .ToDictionary(group => group.Key, group => group.First().Reps, StringComparer.Ordinal);

    private static T? ReadOptional<T>(string json) where T : class
        => string.IsNullOrWhiteSpace(json) ? null : Json.Read<T>(json);
}
