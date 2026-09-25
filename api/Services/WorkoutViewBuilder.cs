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

        var (exercisePrs, setPrs, sessionPrCounts) = await ComputePrs(db, sessions, ct);

        return sessions.ToDictionary(session => session.Id, session => BuildView(session,
            exercisesBySession.GetValueOrDefault(session.Id) ?? [], setsByExercise, exercisePrs, setPrs,
            sessionPrCounts.GetValueOrDefault(session.Id, 0)));
    }

    public static async Task<(Dictionary<Guid, (bool IsPr, double? PrE1rmKg)> ExercisePrs,
        Dictionary<Guid, (bool IsPr, double? Estimated1RmKg)> SetPrs,
        Dictionary<Guid, int> SessionPrCounts)> ComputePrs(
        AppDb db,
        IReadOnlyList<WorkoutSession> requestedSessions,
        CancellationToken ct)
    {
        var exercisePrs = new Dictionary<Guid, (bool IsPr, double? PrE1rmKg)>();
        var setPrs = new Dictionary<Guid, (bool IsPr, double? Estimated1RmKg)>();
        var sessionPrCounts = new Dictionary<Guid, int>();

        var user = db.CurrentUser;
        if (user == null || requestedSessions.Count == 0)
            return (exercisePrs, setPrs, sessionPrCounts);

        var allDoneSets = await (from s in db.Sets.AsNoTracking()
                                 join e in db.SessionExercises.AsNoTracking() on s.SessionExerciseId equals e.Id
                                 join w in db.Workouts.AsNoTracking() on e.SessionId equals w.Id
                                 where w.UserId == user && w.FinishedAt != null && s.Done && !s.Warmup
                                 select new
                                 {
                                     SessionId = w.Id,
                                     w.FinishedAt,
                                     w.StartedAt,
                                     ExerciseId = e.ExerciseId,
                                     e.NameSnapshot,
                                     e.LoadModel,
                                     SessionExerciseId = e.Id,
                                     SetId = s.Id,
                                     s.WeightKg,
                                     s.SystemLoadKg,
                                     s.Reps,
                                     s.Rpe
                                 }).ToListAsync(ct);

        var sessionsChronological = allDoneSets
            .GroupBy(x => new { x.SessionId, x.FinishedAt, x.StartedAt })
            .OrderBy(g => g.Key.FinishedAt)
            .ThenBy(g => g.Key.StartedAt)
            .ToList();

        var runningBest = new Dictionary<(Guid, string), double>();

        foreach (var sessionGroup in sessionsChronological)
        {
            var sId = sessionGroup.Key.SessionId;
            var prCount = 0;

            var exerciseGroups = sessionGroup.GroupBy(x => (x.ExerciseId ?? Guid.Empty, CatalogService.Normalize(x.NameSnapshot)));
            foreach (var exGroup in exerciseGroups)
            {
                var key = exGroup.Key;
                runningBest.TryGetValue(key, out var previousBest);
                var hadPrevious = runningBest.ContainsKey(key);

                double sessionMax = 0;
                Guid? bestSetId = null;

                foreach (var s in exGroup)
                {
                    var load = s.LoadModel == LoadModels.FullBodyweight ? (s.SystemLoadKg ?? s.WeightKg) : s.WeightKg;
                    var estimate = Progression.Estimate1Rm(load, s.Reps, s.Rpe);
                    if (estimate is { } eVal)
                    {
                        setPrs[s.SetId] = (false, eVal);
                        if (eVal > sessionMax)
                        {
                            sessionMax = eVal;
                            bestSetId = s.SetId;
                        }
                    }
                }

                var sessionExerciseId = exGroup.First().SessionExerciseId;
                if (sessionMax > 0)
                {
                    if (hadPrevious && sessionMax > previousBest + 1e-4)
                    {
                        exercisePrs[sessionExerciseId] = (true, sessionMax);
                        if (bestSetId != null) setPrs[bestSetId.Value] = (true, sessionMax);
                        prCount++;
                        runningBest[key] = sessionMax;
                    }
                    else
                    {
                        exercisePrs[sessionExerciseId] = (false, sessionMax);
                        if (!hadPrevious) runningBest[key] = sessionMax;
                    }
                }
            }
            sessionPrCounts[sId] = prCount;
        }

        return (exercisePrs, setPrs, sessionPrCounts);
    }

    public static SessionView BuildView(
        WorkoutSession session,
        IReadOnlyList<SessionExercise> exercises,
        IReadOnlyDictionary<Guid, List<CompletedSet>> setsByExercise,
        IReadOnlyDictionary<Guid, (bool IsPr, double? PrE1rmKg)> exercisePrs,
        IReadOnlyDictionary<Guid, (bool IsPr, double? Estimated1RmKg)> setPrs,
        int sessionPrCount = 0)
    {
        var sets = exercises.SelectMany(e => setsByExercise.GetValueOrDefault(e.Id) ?? []).ToList();
        var done = sets.Where(s => s.Done).ToList();
        var workingDone = done.Where(s => !s.Warmup).ToList();
        var warmupDone = done.Where(s => s.Warmup).ToList();
        var loadModels = exercises.ToDictionary(e => e.Id, e => e.LoadModel);
        var external = workingDone.Where(s => s.WeightKg != null && s.SystemLoadKg == null &&
            loadModels.GetValueOrDefault(s.SessionExerciseId, LoadModels.External) == LoadModels.External).ToList();
        var system = workingDone.Where(s => s.SystemLoadKg != null).ToList();
        var bodyWeight = ReadOptional<BodyWeightSnapshot>(session.BodyWeightSnapshotJson);
        var context = ReadOptional<NutritionTrainingContext>(session.NutritionContextJson);
        return new SessionView(session.Id, session.TemplateId, session.ProgramId, session.Name, session.Note, session.Active,
            session.StartedAt, session.FinishedAt, session.Revision,
            exercises.Select(e =>
            {
                var exerciseSets = setsByExercise.GetValueOrDefault(e.Id) ?? [];
                var canRestore = e.IsReplacement && !string.IsNullOrEmpty(e.BaselineJson) && !exerciseSets.Any(s => s.Done);
                var (isExPr, prE1rmKg) = exercisePrs.GetValueOrDefault(e.Id, (false, null));
                return new SessionExerciseView(e.Id, e.ExerciseId, e.NameSnapshot, e.Position, e.Note,
                    Json.Read<List<SetPrescription>>(e.PrescriptionJson),
                    exerciseSets.Select(s =>
                    {
                        var (isSetPr, setE1rmKg) = setPrs.GetValueOrDefault(s.Id, (false, null));
                        return new SetView(s.Id, s.Position, s.WeightKg, s.Reps, s.Rpe, s.Done, s.Warmup,
                            s.WorkingSetOrdinal, s.ResistanceMode, s.SystemLoadKg, ReadOptional<SetProgressionSuggestion>(s.SuggestionJson),
                            isSetPr, setE1rmKg, s.Rir);
                    }).ToList(),
                    e.SequenceGroup, Json.Read<List<string>>(e.SubstitutionsJson),
                    ReadOptional<ProgressionView>(e.ProgressionJson), e.LoadModel, e.SourceTemplateExerciseId, e.SourceSlotKey, e.SourcePhaseId,
                    e.SwapGroupKey, e.IsReplacement, e.OriginalExerciseId, e.OriginalNameSnapshot, e.SourcePage, canRestore, e.RestSeconds,
                    e.DemoUrl is { Length: > 0 } demoUrl ? demoUrl : null,
                    isExPr, prE1rmKg);
            }).ToList(),
            external.Count == 0 ? null : external.Sum(s => s.WeightKg!.Value * s.Reps!.Value),
            workingDone.Count, warmupDone.Count, bodyWeight, context,
            system.Count == 0 ? null : system.Sum(s => s.SystemLoadKg!.Value * s.Reps!.Value), session.PausedAt, session.PausedSeconds,
            sessionPrCount);
    }

    private static T? ReadOptional<T>(string json) where T : class
        => string.IsNullOrWhiteSpace(json) ? null : Json.Read<T>(json);
}
