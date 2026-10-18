namespace Workout.Api.Domain;

/// Converts a frozen total-resistance target into the load the lifter enters today. Plain
/// bodyweight has no adjustable load, so a changed reference weight changes the rep estimate.
public static class BodyweightProgression
{
    public static SetProgressionSuggestion Suggest(SetPrescription prescription, IReadOnlyList<SetExposure> history,
        string mode, double step, long? revision, string resistanceMode, double? reference,
        IReadOnlyList<double>? availableLoads = null, DateTime? now = null, DateTime? lastTrained = null)
    {
        history = history.Where(exposure => exposure.ResistanceMode is
            ResistanceModes.Bodyweight or ResistanceModes.Added or ResistanceModes.Assistance).ToList();
        // Measured before the technique filter: partials or myo-reps in the slot are not time away.
        lastTrained ??= ProgressionLayoff.Newest(history);
        var goal = ProgressionEvidence.Reserve(prescription.Rir, prescription.TargetRpe);
        var open = Progression.HasOpenReps(prescription.RepsText) || prescription.RepMin is null;
        var min = open ? null : prescription.RepMin;
        var max = open ? null : prescription.RepMax ?? min;
        history = ProgressionHistory.Prepare(history.Where(x => x.Technique == SetTechniques.Of(prescription)).ToList(), min, max, goal);
        // Without a total to compare (no usable weigh-in today, or none frozen with the last session)
        // the set still progresses on what was entered: the reps follow the policy and the added or
        // assistance weight is repeated as logged, never re-estimated against an unknown bodyweight.
        if (reference is not > 0 || history.FirstOrDefault() is { SystemLoadKg: null })
            return WithoutTotal(prescription, history, mode, revision, resistanceMode, reference, max, now, lastTrained);

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
                PhysicalInput(Math.Max(0, total - weight), step, availableLoads, assistance: false),
            ResistanceModes.Assistance when suggestion.SuggestedLoadKg is { } total =>
                PhysicalInput(Math.Max(0, weight - total), step, availableLoads, assistance: true),
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
        var equipmentAdjustment = input is not null && system is { } physical && suggestion.SuggestedLoadKg is { } target &&
            !ProgressionEvidence.SameLoad(physical, target);
        var reason = adjusted
            ? "Bodyweight adjustment: the entered load accounts for your current Nutrition bodyweight. " + suggestion.Reason
            : source is null && resistanceMode == ResistanceModes.Bodyweight
                ? "First time through at your Nutrition bodyweight. Log actual reps and effort." : suggestion.Reason;
        return suggestion with { SuggestedLoadKg = input, SuggestedSystemLoadKg = system,
            IsBodyweightAdjustment = adjusted,
            Reason = reason + (equipmentAdjustment
                ? " Adjusted to an available equipment weight; total resistance differs from the estimate. Log actual effort." : "") };
    }

    private static SetProgressionSuggestion WithoutTotal(SetPrescription prescription, IReadOnlyList<SetExposure> history,
        string mode, long? revision, string resistanceMode, double? reference, int? max, DateTime? now, DateTime? lastTrained)
    {
        var entered = resistanceMode is ResistanceModes.Added or ResistanceModes.Assistance;
        var same = history.Where(exposure => exposure.ResistanceMode == resistanceMode).ToList();
        // Reps only compare at the same entered weight; plain bodyweight has none to differ.
        var suggestion = Progression.Suggest(prescription, same, mode, new LoadOptions(0), revision, ResistanceModes.RepsOnly,
            entered ? exposure => exposure.LoadKg : _ => null, now, lastTrained);
        var source = same.FirstOrDefault(exposure => exposure.SessionId == suggestion.SourceSessionId);
        var input = entered ? source?.LoadKg : null;
        var system = reference is > 0 ? resistanceMode switch
        {
            ResistanceModes.Bodyweight => reference,
            ResistanceModes.Added when input is { } added => reference + added,
            ResistanceModes.Assistance when input is { } assistance => Math.Max(0, reference.Value - assistance),
            _ => null
        } : null;
        var top = max is { } upper && source?.Reps >= upper && suggestion.SuggestedReps >= upper;
        var why = reference is > 0
            ? "The last session has no recorded bodyweight, so total resistance can't be compared"
            : "No recent Nutrition bodyweight, so total resistance can't be estimated";
        var reason = source is null ? why + ". Log actual reps and effort."
            : entered && top ? why + (resistanceMode == ResistanceModes.Added
                ? ": top of the range at this added weight. Add weight when these reps feel within the target effort."
                : ": top of the range at this assistance. Take some away when these reps feel within the target effort.")
            : entered ? why + $": keep the same {(resistanceMode == ResistanceModes.Added ? "added weight" : "assistance")}. " + suggestion.Reason
            : why + ". " + suggestion.Reason;
        return suggestion with
        {
            SuggestedLoadKg = input, SuggestedSystemLoadKg = system, ResistanceMode = resistanceMode,
            IsBodyweightAdjustment = false, PreviousLoadKg = input is null ? null : source?.LoadKg, Reason = reason
        };
    }

    /// A changed weigh-in can put a held total between equipment steps. Choose the easier
    /// physical input where possible: less added load, or more assistance. Keep the actual
    /// assistance entry even when it exceeds bodyweight and total resistance bottoms out at zero.
    private static double PhysicalInput(double target, double step, IReadOnlyList<double>? available, bool assistance)
    {
        if (available is { Count: > 0 })
            return assistance
                ? available.Where(load => load >= target - 1e-9).DefaultIfEmpty(available.Max()).Min()
                : available.Where(load => load <= target + 1e-9).DefaultIfEmpty(available.Min()).Max();
        if (step <= 0) return Math.Min(1000, target);
        var result = (assistance ? Math.Ceiling((target - 1e-9) / step) : Math.Floor((target + 1e-9) / step)) * step;
        return Math.Max(0, Math.Min(result, Progression.RoundDownToStep(1000, step)));
    }
}
