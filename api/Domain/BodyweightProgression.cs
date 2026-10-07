namespace Workout.Api.Domain;

/// Converts a frozen total-resistance target into the load the lifter enters today. Plain
/// bodyweight has no adjustable load, so a changed reference weight changes the rep estimate.
public static class BodyweightProgression
{
    public static SetProgressionSuggestion Suggest(SetPrescription prescription, IReadOnlyList<SetExposure> history,
        string mode, double step, long? revision, string resistanceMode, double? reference,
        IReadOnlyList<double>? availableLoads = null, DateTime? now = null)
    {
        history = history.Where(exposure => exposure.ResistanceMode is
            ResistanceModes.Bodyweight or ResistanceModes.Added or ResistanceModes.Assistance).ToList();
        // Measured before the technique filter: partials or myo-reps in the slot are not time away.
        var lastTrained = ProgressionLayoff.Newest(history);
        var goal = ProgressionEvidence.Reserve(prescription.Rir, prescription.TargetRpe);
        var open = Progression.HasOpenReps(prescription.RepsText) || prescription.RepMin is null;
        var min = open ? null : prescription.RepMin;
        var max = open ? null : prescription.RepMax ?? min;
        history = ProgressionHistory.Prepare(history.Where(x => x.Technique == SetTechniques.Of(prescription)).ToList(), min, max, goal);
        if (reference is not > 0)
        {
            var fallback = Progression.Suggest(prescription, history.Where(x => x.ResistanceMode == resistanceMode).ToList(),
                mode, new LoadOptions(0), revision, resistanceMode, exposure => exposure.SystemLoadKg, now, lastTrained);
            var last = history.FirstOrDefault(x => x.SessionId == fallback.SourceSessionId);
            var reps = last?.Reps is { } completed ? Math.Clamp(completed, min ?? 1, max ?? 1000) : fallback.SuggestedReps;
            return fallback with { SuggestedLoadKg = null, SuggestedSystemLoadKg = null, SuggestedReps = reps,
                Reason = "No recent Nutrition bodyweight is available. Log actual reps and effort; total resistance cannot be estimated." };
        }

        var weight = reference.Value;
        var loads = resistanceMode switch
        {
            ResistanceModes.Added => new LoadOptions(step, weight, weight, weight + 1000,
                availableLoads?.Select(load => weight + load).ToList()),
            ResistanceModes.Assistance => new LoadOptions(step, weight, 0, weight,
                availableLoads?.Select(load => Math.Max(0, weight - load)).Distinct().Order().ToList()),
            _ => new LoadOptions(0)
        };
        // Bodyweight changes must not join consecutive hard exposures at different resistance.
        // Missing snapshots break continuity rather than being replaced with entered load.
        var comparable = history.TakeWhile(exposure => ProgressionEvidence.SameLoad(
            exposure.SystemLoadKg, history.FirstOrDefault()?.SystemLoadKg)).ToList();
        var suggestion = Progression.Suggest(prescription, comparable, mode, loads, revision,
            resistanceMode, exposure => exposure.SystemLoadKg, now, lastTrained);
        var input = resistanceMode switch
        {
            ResistanceModes.Added when suggestion.SuggestedLoadKg is { } total =>
                Progression.RoundToStep(Math.Max(0, total - weight), availableLoads is null ? step : 0),
            ResistanceModes.Assistance when suggestion.SuggestedLoadKg is { } total =>
                Progression.RoundToStep(Math.Max(0, weight - total), availableLoads is null ? step : 0),
            _ => (double?)null
        };
        var system = resistanceMode switch
        {
            ResistanceModes.Bodyweight => weight,
            ResistanceModes.Added when input is { } added => weight + added,
            ResistanceModes.Assistance when input is { } assistance => Math.Max(0, weight - assistance),
            _ => (double?)null
        };

        var source = comparable.FirstOrDefault();
        var changed = system is { } actual && source?.SystemLoadKg is { } previous &&
            !ProgressionEvidence.SameLoad(actual, previous);
        if (resistanceMode == ResistanceModes.Bodyweight && changed)
        {
            var predicted = ProgressionEvidence.RepsAt(source!, source!.SystemLoadKg, weight, goal);
            var reps = predicted is { } estimate
                ? Math.Clamp(estimate, min ?? 1, max ?? 1000)
                : source.Reps is { } last ? Math.Clamp(last, min ?? 1, max ?? 1000) : suggestion.SuggestedReps;
            if (ProgressionLayoff.Days(lastTrained, now) is >= ProgressionLayoff.HoldDays)
                reps = Math.Min(reps, suggestion.SuggestedReps);
            return suggestion with { SuggestedLoadKg = null, SuggestedSystemLoadKg = weight,
                SuggestedReps = reps, IsBodyweightAdjustment = true, IsRepRangeTransition = false,
                Reason = $"Nutrition bodyweight changed: aim for {reps} reps at today's bodyweight. This is an estimate; log actual effort." };
        }
        var previousReference = source?.ResistanceMode switch
        {
            ResistanceModes.Bodyweight => source.SystemLoadKg,
            ResistanceModes.Added when source.LoadKg is { } added => source.SystemLoadKg - added,
            ResistanceModes.Assistance when source.LoadKg is { } assistance => source.SystemLoadKg + assistance,
            _ => null
        };
        var adjusted = input is not null && previousReference is { } oldReference && !ProgressionEvidence.SameLoad(weight, oldReference);
        return suggestion with { SuggestedLoadKg = input, SuggestedSystemLoadKg = system,
            IsBodyweightAdjustment = adjusted,
            Reason = adjusted ? "Bodyweight adjustment: the entered load accounts for your current Nutrition bodyweight. " + suggestion.Reason
                : source is null && resistanceMode == ResistanceModes.Bodyweight
                    ? "First time through at your Nutrition bodyweight. Log actual reps and effort." : suggestion.Reason };
    }
}
