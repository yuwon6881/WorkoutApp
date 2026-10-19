using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class WorkoutService
{
    private async Task RefreshReplacementSuggestions(WorkoutSession session, SessionExercise exercise, List<CompletedSet> sets,
        string loadModel, CancellationToken ct)
    {
        // Reps and seconds never carry across a timed/reps swap; a timed replacement gets no rep suggestion.
        // A logged set is what was lifted and is never rewritten; it still counts toward the ordinal.
        var timed = exercise.ExerciseId is { } timedId && (await CatalogService.TrackingModesFor(db, [timedId], ct)).ContainsKey(timedId);
        foreach (var set in sets.Where(s => !s.Done))
        {
            if (timed) set.Reps = null;
            else set.DurationSeconds = null;
        }
        if (timed)
        {
            var timedHistory = await PreviousExposures(exercise.ExerciseId, exercise.NameSnapshot, ct);
            var timedLast = ProgressionLayoff.Newest(timedHistory.Values.SelectMany(exposures => exposures));
            var timedOrdinal = 0;
            foreach (var set in sets.OrderBy(s => s.Position))
            {
                if (set.Warmup) continue;
                timedOrdinal++;
                if (!set.Done)
                    set.WeightKg = TimedStartLoad(timedHistory.GetValueOrDefault(timedOrdinal) ?? [], set.ResistanceMode, timedLast);
            }
            return;
        }
        var prescriptions = Json.Read<List<SetPrescription>>(exercise.PrescriptionJson);
        var context = ReadOptional<NutritionTrainingContext>(session.NutritionContextJson);
        var result = new NutritionContextResult(context, NutritionContextService.Mode(context, DateTime.UtcNow), context is not null, context?.Confirmed == true, null);
        var bodyWeight = ReadOptional<BodyWeightSnapshot>(session.BodyWeightSnapshotJson);
        var userUnit = await LoadRuleReader.AccountUnit(db, ct);
        var info = await progression.LoadInfo([exercise.ExerciseId], ct);
        var step = exercise.ExerciseId is { } id && info.TryGetValue(id, out var found) ? found.StepKg : Progression.DefaultStep(userUnit);
        var histories = await PreviousExposures(exercise.ExerciseId, exercise.NameSnapshot, ct);
        var lastTrained = ProgressionLayoff.Newest(histories.Values.SelectMany(exposures => exposures));
        var workingOrdinal = 0; SetProgressionSuggestion? first = null; SetProgressionSuggestion? straight = null;
        SetPrescription? straightPlan = null;
        foreach (var set in sets.OrderBy(s => s.Position))
        {
            if (set.Warmup) continue;
            workingOrdinal++;
            if (set.Done) continue;
            var prescription = prescriptions.ElementAtOrDefault(set.Position);
            if (prescription is null) continue;
            var enteredReps = set.Reps;
            var enteredRpe = set.Rpe;
            var mode = ResolveResistanceMode(loadModel, exercise.NameSnapshot);
            var suggestion = Progression.ForPrescription(prescription, NoHeavierThanBefore(prescription, AddedSet(prescription,
                FollowStraightSets(prescription, straight,
                    MakeSuggestion(prescription, histories.GetValueOrDefault(workingOrdinal) ?? [], result.Mode, step, result, mode, loadModel, bodyWeight,
                        exercise.ExerciseId is { } loadId ? info.GetValueOrDefault(loadId)?.AvailableLoadsKg : null, lastTrained)),
                straightPlan, straight), straightPlan, straight));
            if (SetTechniques.Of(prescription) is null) (straight, straightPlan) = (suggestion, prescription);
            set.WeightKg = suggestion.SuggestedLoadKg; set.SystemLoadKg = suggestion.SuggestedSystemLoadKg;
            set.ResistanceMode = mode; set.SuggestionJson = Json.Write(suggestion); set.Reps = enteredReps; set.Rpe = enteredRpe; first ??= suggestion;
        }
        exercise.ProgressionJson = first is null ? "" : Json.Write(new ProgressionView(first.SuggestedLoadKg, first.SuggestedReps, first.Reason,
            null, null, step, first.ProgressionMode, first.NutritionContextRevision));
    }

    /// A technique never done on this movement before has no history of its own; it starts from the
    /// straight-set load the movement already has rather than from a blank first-time suggestion.
    private SetProgressionSuggestion MakeSuggestion(SetPrescription prescription, IReadOnlyList<SetExposure> exposures,
        string mode, double step, NutritionContextResult context, string resistanceMode, string loadModel,
        BodyWeightSnapshot? bodyWeight, IReadOnlyList<double>? availableLoads = null, DateTime? lastTrained = null)
    {
        var own = OwnSuggestion(prescription, exposures, mode, step, context, resistanceMode, loadModel, bodyWeight, availableLoads, lastTrained);
        if (SetTechniques.Of(prescription) is null || own.SourceSessionId is not null || own.SourceDate is not null) return own;
        var straight = OwnSuggestion(prescription with { Notes = null }, exposures, mode, step, context, resistanceMode, loadModel,
            bodyWeight, availableLoads, lastTrained);
        return straight.SuggestedLoadKg is null && straight.SuggestedSystemLoadKg is null
            ? own
            : FollowStraightSets(prescription, straight, own);
    }

    private SetProgressionSuggestion OwnSuggestion(SetPrescription prescription, IReadOnlyList<SetExposure> exposures,
        string mode, double step, NutritionContextResult context, string resistanceMode, string loadModel,
        BodyWeightSnapshot? bodyWeight, IReadOnlyList<double>? availableLoads, DateTime? lastTrained)
    {
        if (loadModel == LoadModels.FullBodyweight)
            return BodyweightProgression.Suggest(prescription, exposures, mode, step, context.Context?.Revision,
                resistanceMode, bodyWeight?.ReferenceKg, availableLoads, DateTime.UtcNow, lastTrained);

        exposures = exposures.Where(exposure => exposure.ResistanceMode == resistanceMode).ToList();
        var policyMode = loadModel is LoadModels.BodyweightContextOnly or LoadModels.RepsOnly ? ResistanceModes.RepsOnly : resistanceMode;
        return Progression.Suggest(prescription, exposures, mode, new LoadOptions(step, AvailableLoadsKg: availableLoads),
            context.Context?.Revision, policyMode,
            policyMode == ResistanceModes.RepsOnly ? _ => null : null, DateTime.UtcNow, lastTrained) with { ResistanceMode = resistanceMode };
    }

    /// A straight set the movement has no history for at its position (a program that grew from
    /// three sets to four) starts where the straight set before it does, when both are prescribed
    /// alike; a differently prescribed set keeps its own first-time suggestion.
    private static SetProgressionSuggestion AddedSet(SetPrescription prescription, SetProgressionSuggestion own,
        SetPrescription? previousPlan, SetProgressionSuggestion? previous)
    {
        if (SetTechniques.Of(prescription) is not null || own.SourceSessionId is not null || own.SourceDate is not null ||
            previousPlan is null || previous is null || previous.SourceSessionId is null && previous.SourceDate is null)
            return own;
        if (!PrescribedAlike(previousPlan, prescription)) return own;
        // It has no exposure of its own, so it claims no change from one.
        return previous with
        {
            Reason = "A set added since last time: start with the load and reps of the set before it.",
            PreviousLoadKg = null, PreviousReps = null
        };
    }

    /// A straight set prescribed like the straight set before it in the same row is done after it,
    /// on top of its fatigue, so it never starts heavier than that set. Each set reads its own
    /// history, and sets whose histories disagree (one re-aimed lower, the next progressed) would
    /// otherwise ask for back-off sets that climb. Assisted movements are left alone, since more
    /// assistance is easier.
    private static SetProgressionSuggestion NoHeavierThanBefore(SetPrescription prescription, SetProgressionSuggestion own,
        SetPrescription? previousPlan, SetProgressionSuggestion? previous)
    {
        if (SetTechniques.Of(prescription) is not null || previousPlan is null || previous is null ||
            own.ResistanceMode != previous.ResistanceMode ||
            own.ResistanceMode is not (ResistanceModes.External or ResistanceModes.Added) ||
            own.SuggestedLoadKg is not { } load || previous.SuggestedLoadKg is not { } before || load <= before ||
            !PrescribedAlike(previousPlan, prescription))
            return own;
        return own with
        {
            SuggestedLoadKg = before,
            SuggestedSystemLoadKg = previous.SuggestedSystemLoadKg,
            SuggestedReps = previous.SuggestedReps,
            Reason = "Same prescription as the set before it: start no heavier than that set, and add load once it moves up."
        };
    }

    private static bool PrescribedAlike(SetPrescription previous, SetPrescription prescription)
        => previous.RepMin == prescription.RepMin && previous.RepMax == prescription.RepMax &&
           previous.RepsText == prescription.RepsText &&
           ProgressionEvidence.Reserve(previous.Rir, previous.TargetRpe) == ProgressionEvidence.Reserve(prescription.Rir, prescription.TargetRpe);

    /// A timed hold or carry gets no rep-based suggestion, but a loaded one starts from the weight
    /// its set last held, as long as the movement was trained recently enough for that weight to
    /// stand. Bodyweight and loadless holds have no weight to carry.
    private static double? TimedStartLoad(IReadOnlyList<SetExposure> exposures, string resistanceMode, DateTime? lastTrained)
    {
        if (resistanceMode is not (ResistanceModes.External or ResistanceModes.Added or ResistanceModes.Assistance)) return null;
        if (ProgressionLayoff.Days(lastTrained, DateTime.UtcNow) is >= ProgressionLayoff.ReduceDays) return null;
        return exposures.FirstOrDefault(exposure => exposure.ResistanceMode == resistanceMode && exposure.LoadKg is not null)?.LoadKg;
    }

    /// A technique set that comes after straight sets in the same exercise (a last-set myo-rep,
    /// partial or drop set) is started with the load those sets just used, so it follows their
    /// progression instead of running its own. Its reps come from the prescription alone: a rep
    /// count inflated by the technique must never read as a reason to add load. Straight sets with
    /// no load to hand on (never done yet) leave the technique set on its own history.
    private static SetProgressionSuggestion FollowStraightSets(SetPrescription prescription,
        SetProgressionSuggestion? straight, SetProgressionSuggestion own)
    {
        if (SetTechniques.Of(prescription) is null || straight is null || straight.ResistanceMode != own.ResistanceMode)
            return own;
        if (straight.SuggestedLoadKg is null && straight.SuggestedSystemLoadKg is null && own.SuggestedLoadKg is not null)
            return own;
        return straight with
        {
            SuggestedReps = prescription.RepMin ?? 0,
            Reason = "Technique set: start with your straight-set load and log the reps you get. It counts toward volume, not strength records or load progression.",
            IsRepRangeTransition = false
        };
    }

}
