using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class WorkoutService
{
    /// The unlogged sets whose reps still hold the fill their current suggestion gave them, rather
    /// than a count the lifter typed. Read before a swap clears the suggestions it replaces.
    private static HashSet<Guid> SetsHoldingRepFill(SessionExercise exercise, IEnumerable<CompletedSet> sets)
    {
        var prescriptions = Json.Read<List<SetPrescription>>(exercise.PrescriptionJson);
        return sets.Where(set => !set.Done && !set.Warmup && prescriptions.ElementAtOrDefault(set.Position) is { } plan
                && ReadOptional<SetProgressionSuggestion>(set.SuggestionJson) is { } suggestion
                && set.Reps == Progression.PrefillReps(plan, suggestion))
            .Select(set => set.Id).ToHashSet();
    }

    /// Reps the lifter typed stay; reps that only held the replaced exercise's fill (listed in
    /// <paramref name="repFill"/>) take the replacement's own, so a set never shows one exercise's
    /// target over another exercise's count.
    private async Task RefreshReplacementSuggestions(WorkoutSession session, SessionExercise exercise, List<CompletedSet> sets,
        string loadModel, IReadOnlySet<Guid> repFill, CancellationToken ct)
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
            var timedPrescriptions = Json.Read<List<SetPrescription>>(exercise.PrescriptionJson);
            TimedLoad? previousTimed = null;
            foreach (var set in sets.OrderBy(s => s.Position))
            {
                if (set.Warmup) continue;
                timedOrdinal++;
                // A set added in the session has no plan entry; it still starts from its history.
                var timedPlan = timedPrescriptions.ElementAtOrDefault(set.Position) ?? new SetPrescription(null, null, null, null, null, null, null);
                if (!set.Done)
                    set.WeightKg = NoHeavierThanBefore(timedPlan, set.ResistanceMode, TimedStartLoad(timedPlan,
                        timedHistory.GetValueOrDefault(timedOrdinal) ?? [], set.ResistanceMode, timedLast), previousTimed);
                previousTimed = new TimedLoad(timedPlan, set.ResistanceMode, set.WeightKg);
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
        var previousOfKind = new Dictionary<string, PlannedSuggestion>();
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
                straightPlan, straight), previousOfKind));
            if (SetTechniques.Of(prescription) is null) (straight, straightPlan) = (suggestion, prescription);
            previousOfKind[KindOf(prescription)] = new PlannedSuggestion(prescription, suggestion);
            set.WeightKg = suggestion.SuggestedLoadKg; set.SystemLoadKg = suggestion.SuggestedSystemLoadKg;
            set.ResistanceMode = mode; set.SuggestionJson = Json.Write(suggestion); set.Rpe = enteredRpe; first ??= suggestion;
            set.Reps = repFill.Contains(set.Id) ? Progression.PrefillReps(prescription, suggestion) : enteredReps;
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

    private sealed record PlannedSuggestion(SetPrescription Plan, SetProgressionSuggestion Suggestion);
    private sealed record TimedLoad(SetPrescription Plan, string ResistanceMode, double? LoadKg);

    /// Sets are compared only with the earlier set of the same kind: straight with straight, and a
    /// myo-rep, partial or drop set with the one of its own technique before it.
    private static string KindOf(SetPrescription prescription) => SetTechniques.Of(prescription) ?? "";

    /// A set prescribed like the earlier set of its kind in the same row is done after it, on top of
    /// its fatigue, so it never starts heavier than that set. Each set reads its own history, and
    /// sets whose histories disagree (one re-aimed lower, the next progressed) would otherwise ask
    /// for back-off sets that climb. Only a load can be capped: assisted movements are left alone,
    /// since more assistance is easier, and loadless sets keep their own reps (a later set aiming
    /// for more reps than a fatigued earlier one is how carried-over fatigue is answered).
    private static SetProgressionSuggestion NoHeavierThanBefore(SetPrescription prescription, SetProgressionSuggestion own,
        IReadOnlyDictionary<string, PlannedSuggestion> previousOfKind)
    {
        if (!previousOfKind.TryGetValue(KindOf(prescription), out var earlier)) return own;
        var previous = earlier.Suggestion;
        if (own.ResistanceMode != previous.ResistanceMode || !CappableMode(own.ResistanceMode) ||
            own.SuggestedLoadKg is not { } load || previous.SuggestedLoadKg is not { } before || load <= before ||
            !PrescribedAlike(earlier.Plan, prescription))
            return own;
        return own with
        {
            SuggestedLoadKg = before,
            SuggestedSystemLoadKg = previous.SuggestedSystemLoadKg,
            SuggestedReps = previous.SuggestedReps,
            Reason = "Same prescription as the set before it: start no heavier than that set, and add load once it moves up."
        };
    }

    /// The timed counterpart: a loaded hold or carry starts no heavier than the like-prescribed
    /// timed set before it in the row.
    private static double? NoHeavierThanBefore(SetPrescription prescription, string resistanceMode, double? load, TimedLoad? previous)
        => previous is { LoadKg: { } before } && load is { } own && own > before && previous.ResistanceMode == resistanceMode &&
           CappableMode(resistanceMode) && PrescribedAlike(previous.Plan, prescription)
            ? before : load;

    private static bool CappableMode(string resistanceMode)
        => resistanceMode is ResistanceModes.External or ResistanceModes.Added;

    private static bool PrescribedAlike(SetPrescription previous, SetPrescription prescription)
        => previous.RepMin == prescription.RepMin && previous.RepMax == prescription.RepMax &&
           previous.RepsText == prescription.RepsText &&
           ProgressionEvidence.Reserve(previous.Rir, previous.TargetRpe) == ProgressionEvidence.Reserve(prescription.Rir, prescription.TargetRpe);

    /// A timed hold or carry gets no rep-based suggestion, but a loaded one starts from the weight
    /// its set last held, as long as the movement was trained recently enough for that weight to
    /// stand. Bodyweight and loadless holds have no weight to carry.
    /// When the newest session held the movement in two rows, the row timed like this set is read,
    /// as for rep sets, rather than whichever row came first.
    private static double? TimedStartLoad(SetPrescription prescription, IReadOnlyList<SetExposure> exposures,
        string resistanceMode, DateTime? lastTrained)
    {
        if (resistanceMode is not (ResistanceModes.External or ResistanceModes.Added or ResistanceModes.Assistance)) return null;
        if (ProgressionLayoff.Days(lastTrained, DateTime.UtcNow) is >= ProgressionLayoff.ReduceDays) return null;
        var loaded = exposures.Where(exposure => exposure.ResistanceMode == resistanceMode && exposure.LoadKg is not null).ToList();
        var goal = ProgressionEvidence.Reserve(prescription.Rir, prescription.TargetRpe);
        return ProgressionHistory.OnePerSession(loaded, prescription.RepMin, prescription.RepMax ?? prescription.RepMin, goal)
            .FirstOrDefault()?.LoadKg;
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
