using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class WorkoutService
{
    /// Adds a new session's exercises and sets, with every suggestion frozen from today's history. Start
    /// saves the result; a start preview reads it and throws it away, so both show the same loads.
    private async Task PlanSessionSets(WorkoutSession session, WorkoutTemplate template, NutritionContextResult contextResult,
        BodyWeightSnapshot? bodyWeight, CancellationToken ct)
    {
        var planned = await db.TemplateExercises.AsNoTracking().Where(e => e.TemplateId == template.Id).OrderBy(e => e.Position).ToListAsync(ct);
        var account = await LoadRuleReader.ReadAccountContext(db, ct);
        var userUnit = account.Unit;
        var tracksRir = account.TrackRir;
        var names = await templates.CatalogNames(planned.Select(p => p.ExerciseId), ct);
        var info = await progression.LoadInfo(planned.Select(p => p.ExerciseId), ct, userUnit, account);
        var models = await catalog.LoadModelsFor(planned.Select(p => p.ExerciseId), ct);
        var histories = await PreviousExposuresBatch(planned.Select(p => (p.ExerciseId, p.SourceName)), ct);
        var timed = await CatalogService.TrackingModesFor(db, planned.Select(p => p.ExerciseId), ct);
        foreach (var plan in planned)
        {
            var prescription = ImportLoadBasis.ApplyPrescriptions(Json.Read<List<SetPrescription>>(plan.SetsJson), plan.Note);
            var resolvedName = plan.ExerciseId is { } catalogId && names.TryGetValue(catalogId, out var resolved) ? resolved : plan.SourceName;
            var loadModel = plan.ExerciseId is { } modelId && info.TryGetValue(modelId, out _)
                ? models.GetValueOrDefault(modelId, LoadModels.External) : LoadModels.External;
            var exercise = new SessionExercise
            {
                UserId = session.UserId, SessionId = session.Id, ExerciseId = plan.ExerciseId, Position = plan.Position,
                NameSnapshot = resolvedName, Note = plan.Note, PrescriptionJson = Json.Write(prescription), SequenceGroup = plan.SequenceGroup,
                RestSeconds = plan.RestSeconds,
                SubstitutionsJson = plan.SubstitutionsJson, LoadModel = loadModel,
                SourceTemplateExerciseId = plan.Id, SourceSlotKey = plan.SlotKey, SourcePhaseId = template.ProgramPhaseId, SourcePage = plan.SourcePage,
                DemoUrl = plan.DemoUrl, DemoLinksJson = plan.DemoLinksJson
            };
            db.SessionExercises.Add(exercise);

            var historyKey = (plan.ExerciseId, plan.ExerciseId is null ? CatalogService.Normalize(plan.SourceName) : "");
            var previous = histories.GetValueOrDefault(historyKey) ?? [];
            var lastTrained = ProgressionLayoff.Newest(previous.Values.SelectMany(exposures => exposures));
            var step = plan.ExerciseId is { } id2 && info.TryGetValue(id2, out var found) ? found.StepKg : Progression.DefaultStep(userUnit);
            var oneRepMax = OneRepMaxFor(prescription, loadModel, previous.Values.SelectMany(rows => rows));
            var workingOrdinal = 0;
            // Timed holds are measured in seconds; the rep-based progression has nothing honest to suggest.
            var isTimed = plan.ExerciseId is { } timedId && timed.ContainsKey(timedId);
            var firstSuggestion = (SetProgressionSuggestion?)null;
            var straightSuggestion = (SetProgressionSuggestion?)null;
            var straightPlan = (SetPrescription?)null;
            var previousOfKind = new Dictionary<string, PlannedSuggestion>();
            var previousTimed = (TimedLoad?)null;
            for (var index = 0; index < prescription.Count; index++)
            {
                var planSet = prescription[index];
                if (planSet.Warmup)
                {
                    db.Sets.Add(new CompletedSet
                    {
                        UserId = session.UserId, SessionExerciseId = exercise.Id, Position = index,
                        Reps = isTimed ? null : planSet.RepMin, Rpe = null, Done = false, Warmup = true,
                        ResistanceMode = WarmupResistanceMode(loadModel, resolvedName)
                    });
                    continue;
                }

                workingOrdinal++;
                var resistanceMode = ResolveResistanceMode(loadModel, resolvedName);
                var exposures = previous.GetValueOrDefault(workingOrdinal) ?? [];
                if (isTimed)
                {
                    var timedLoad = NoHeavierThanBefore(planSet, resistanceMode,
                        TimedStartLoad(planSet, exposures, resistanceMode, lastTrained), previousTimed);
                    previousTimed = new TimedLoad(planSet, resistanceMode, timedLoad);
                    db.Sets.Add(new CompletedSet
                    {
                        UserId = session.UserId, SessionExerciseId = exercise.Id, Position = index,
                        WorkingSetOrdinal = workingOrdinal, Done = false, Warmup = false, SuggestionJson = "",
                        ResistanceMode = resistanceMode, WeightKg = timedLoad
                    });
                    continue;
                }
                var suggestion = Progression.ForPrescription(planSet, NoHeavierThanBefore(planSet, AddedSet(planSet,
                    FollowStraightSets(planSet, straightSuggestion,
                        MakeSuggestion(planSet, exposures, contextResult.Mode, step, contextResult, resistanceMode, loadModel, bodyWeight,
                            plan.ExerciseId is { } loadId ? info.GetValueOrDefault(loadId)?.AvailableLoadsKg : null, lastTrained, oneRepMax)),
                    straightPlan, straightSuggestion), previousOfKind));
                if (SetTechniques.Of(planSet) is null) (straightSuggestion, straightPlan) = (suggestion, planSet);
                previousOfKind[KindOf(planSet)] = new PlannedSuggestion(planSet, suggestion);
                firstSuggestion ??= suggestion;
                // Effort is filled in only where history already fills in the load and reps.
                var effort = tracksRir && (suggestion.SourceSessionId is not null || suggestion.SourceDate is not null)
                    ? EffortPrefill.For(planSet) : null;
                db.Sets.Add(new CompletedSet
                {
                    UserId = session.UserId, SessionExerciseId = exercise.Id, Position = index,
                    WorkingSetOrdinal = workingOrdinal, WeightKg = suggestion.SuggestedLoadKg,
                    Reps = Progression.PrefillReps(planSet, suggestion), Rpe = effort?.Rpe, Rir = effort?.Rir, Done = false, Warmup = false,
                    SuggestionJson = Json.Write(suggestion), ResistanceMode = resistanceMode,
                    SystemLoadKg = suggestion.SuggestedSystemLoadKg
                });
            }
            // Legacy summary consumers see the first working set, while every set has its own
            // authoritative snapshot in SuggestionJson.
            exercise.ProgressionJson = firstSuggestion is null ? "" : Json.Write(new ProgressionView(
                firstSuggestion.SuggestedLoadKg, firstSuggestion.SuggestedReps, firstSuggestion.Reason,
                null, null, step, firstSuggestion.ProgressionMode, firstSuggestion.NutritionContextRevision));
            exercise.BaselineJson = CreateExerciseBaseline(exercise, db.Sets.Local.Where(s => s.SessionExerciseId == exercise.Id));
        }
    }
}
