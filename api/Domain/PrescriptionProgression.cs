namespace Workout.Api.Domain;

internal static class PrescriptionProgression
{
    public static SetProgressionSuggestion Suggest(
        SetPrescription prescription, IReadOnlyList<SetExposure> history, string progressionMode,
        LoadOptions loads, long? revision, string resistanceMode, Func<SetExposure, double?>? selectLoad, DateTime? now = null)
    {
        var mode = ProgressionModes.All.Contains(progressionMode) ? progressionMode : ProgressionModes.Normal;
        var selector = selectLoad ?? (exposure => exposure.LoadKg);
        var open = Progression.HasOpenReps(prescription.RepsText) || prescription.RepMin is null;
        var min = open ? (int?)null : prescription.RepMin;
        var max = open ? (int?)null : prescription.RepMax ?? min;
        var goal = ProgressionEvidence.Reserve(prescription.Rir, prescription.TargetRpe);
        // A set only learns from sets done the same way: a partial or myo-rep set says nothing
        // about the straight set in its slot, and the reverse.
        var technique = SetTechniques.Of(prescription);
        history = history.Where(exposure => exposure.Technique == technique).ToList();
        var away = ProgressionLayoff.Days(history, now);
        history = ProgressionHistory.Prepare(history, min, max, goal);
        var source = history.FirstOrDefault();
        var load = source is null ? null : selector(source);
        var repsOnly = resistanceMode == ResistanceModes.RepsOnly;

        SetProgressionSuggestion Result(double? weight, int reps, string reason, bool transition = false)
            => new(repsOnly ? null : weight, reps, reason,
                source?.SessionId == Guid.Empty ? null : source?.SessionId,
                source?.CompletedAt == DateTime.MinValue ? null : source?.CompletedAt,
                mode, revision, false, selectLoad is null ? null : weight, resistanceMode, transition);

        if (source?.Reps is not { } actual || load is null && !repsOnly)
            return Result(null, min ?? 0, "First time through. Enter the load you actually use.");

        var reserve = ProgressionEvidence.Reserve(source);
        var lower = min ?? actual;
        var upper = max ?? actual;
        var changed = ProgressionEvidence.Changed(source, min, max, goal);
        var rebuilding = source.IsRepRangeTransition && !changed && actual < lower;
        var repeatReps = rebuilding ? actual : Math.Clamp(actual, lower, upper);

        if (away is >= ProgressionLayoff.HoldDays)
        {
            if (away < ProgressionLayoff.ReduceDays)
                return Result(load, repeatReps, $"Back after {away} days away: repeat your last session before progressing.", rebuilding);
            var factor = ProgressionLayoff.Factor(away.Value);
            var eased = load is { } current && loads.Adjustable && !repsOnly ? Math.Min(current, loads.AtMost(current * factor)) : load;
            return Result(eased, lower, $"Back after {away} days away: about {(int)Math.Round((1 - factor) * 100)}% lighter to rebuild.");
        }

        // Changing the program's targets is not a failed exposure. Re-select a suitable load
        // before evaluating streaks against the new prescription.
        if (changed && reserve is not null && load is > 0 && loads.Adjustable && !repsOnly &&
            ProgressionEvidence.Capacity(source, load) is { } capacity)
        {
            var predicted = ProgressionEvidence.RepsAt(source, load, load.Value, goal);
            if (predicted < lower - 1 || predicted > upper + 1)
            {
                var selected = loads.AtMost(capacity / (30 + lower + (goal ?? reserve.Value)));
                if (selected > 0)
                {
                    var estimate = ProgressionEvidence.RepsAt(source, load, selected, goal) ?? lower;
                    return Result(selected, Math.Clamp(estimate, lower, upper),
                        "Prescription changed: estimated load and reps for the new target. Adjust from actual effort.");
                }
            }
        }

        var hardStreak = changed ? 0 : ProgressionEvidence.Streak(history,
            exposure => !ProgressionEvidence.Changed(exposure, min, max, goal) &&
                ProgressionEvidence.Hard(exposure, lower, goal));
        if (hardStreak > 0)
        {
            if (!loads.Adjustable || repsOnly)
                return Result(load, repeatReps, "No adjustable load: repeat the reps and use an easier variation if needed to match the intended effort.", rebuilding);
            if (hardStreak == 1)
                return Result(load, repeatReps, rebuilding
                    ? "Hold the transition reps after a hard exposure; match the intended effort before rebuilding."
                    : "Repeat the reps after a hard exposure; match the intended effort before progressing.", rebuilding);
            if (hardStreak == 2)
                return Result(load is { } weight ? loads.Previous(weight) : null, lower,
                    "One equipment step lighter after two hard exposures.");
            var successful = history.FirstOrDefault(exposure => exposure.Reps >= lower &&
                ProgressionEvidence.MeetsEffort(exposure, goal) && selector(exposure) is not null);
            var baseline = hardStreak == 3 && successful is not null ? selector(successful) : load;
            // An older successful load must never make a recovery recommendation heavier.
            var reduced = baseline is { } previous ? loads.AtMost(Math.Min(previous, load ?? previous) * .925) : (double?)null;
            // A newly configured list may start above a historical load. Recovery must
            // hold that load rather than increase to the list's minimum.
            if (reduced is { } selected && load is { } current) reduced = Math.Min(selected, current);
            return Result(reduced, lower, hardStreak == 3
                ? "Three hard exposures in a row. Deload 7.5% from the lower of current and last successful load and rebuild."
                : "Continued difficulty after deload. Reducing another 7.5% from the current load.");
        }

        if (!open && !changed && loads.Adjustable && !repsOnly && load is > 0 && actual < upper &&
            ProgressionCalibration.Plateaued(history, load, goal, selector))
        {
            if (mode != ProgressionModes.Normal)
                return Result(load, repeatReps, "Holding performance during a calorie deficit is expected. Repeat the load and reps rather than forcing progress.", rebuilding);
            var reset = ProgressionCalibration.ResetLoad(load.Value, loads);
            var reps = ProgressionEvidence.RepsAt(source, load, reset, goal) ?? upper;
            return Result(reset, Math.Clamp(reps, lower, upper),
                $"No progress in {ProgressionCalibration.PlateauSessions} sessions at this load: reset about 5% and rebuild.");
        }

        var required = ProgressionModes.QualifiedExposures(mode);
        if (reserve is null) required = Math.Max(2, required);
        bool Qualified(SetExposure exposure)
            => exposure.Reps >= upper && ProgressionEvidence.SameLoad(load, selector(exposure)) &&
                !ProgressionEvidence.Changed(exposure, min, max, goal) &&
                (reserve is null ? ProgressionEvidence.Reserve(exposure) is null : ProgressionEvidence.MeetsEffort(exposure, goal));
        var qualified = ProgressionEvidence.Streak(history, Qualified);

        if (!open && reserve is null && qualified < required)
        {
            if (mode == ProgressionModes.Preservation && actual >= lower && actual < upper)
                return Result(load, repeatReps,
                    "Preservation heuristic: an in-range rep increase needs a target effort and two consecutive high-reserve exposures. Actual effort is unknown.", rebuilding);

            var consistent = ProgressionEvidence.Streak(history, exposure =>
                ProgressionEvidence.Reserve(exposure) is null && exposure.Reps >= actual &&
                ProgressionEvidence.SameLoad(load, selector(exposure)) &&
                !ProgressionEvidence.Changed(exposure, min, max, goal));
            if (actual >= lower && actual < upper && consistent >= required)
                return Result(load, actual + 1, "Repeated reps at this load: cautiously aim for one more. Actual effort is unknown.");
            return Result(load, repeatReps,
                "No actual RPE or RIR was recorded. Repeat the load; repeated results are needed before a cautious increase.", rebuilding);
        }
        if (reserve is not null && !ProgressionEvidence.MeetsEffort(source, goal))
            return Result(load, repeatReps, "Repeat the last load and reps. The exposure was not within the target effort range.", rebuilding);

        if (open)
        {
            // With no ceiling, a single set cannot earn a load increase. Require improving reps
            // at the same load, repeated acceptable effort, and enough evidence for this mode.
            var earlier = history.Skip(1).FirstOrDefault();
            var improving = earlier?.Reps is { } oldReps && actual > oldReps &&
                ProgressionEvidence.SameLoad(load, selector(earlier));
            var stable = ProgressionEvidence.Streak(history, exposure =>
                ProgressionEvidence.SameLoad(load, selector(exposure)) &&
                (reserve is null ? ProgressionEvidence.Reserve(exposure) is null : ProgressionEvidence.MeetsEffort(exposure, goal)));
            if (!improving || stable < Math.Max(reserve is null ? 3 : 2, required))
                return Result(load, actual, "No rep target: repeat the load and log actual reps; build consistent performance before increasing.");
            lower = Math.Max(1, actual - Math.Max(2, (int)Math.Ceiling(actual * .25)));
        }
        else if (actual < upper)
        {
            if (actual < lower - 1 && !(source.IsRepRangeTransition && !changed))
            {
                if (reserve is not null && loads.Adjustable && !repsOnly &&
                    ProgressionEvidence.Capacity(source, load) is { } rangeCapacity)
                {
                    var selected = loads.AtMost(rangeCapacity / (30 + lower + (goal ?? reserve.Value)));
                    if (selected > 0 && selected < load)
                        return Result(selected, lower, "Adjust the load to reach the prescribed range at the intended effort.");
                }
                return Result(load, lower, "Aim for the prescribed minimum; adjust the load to match actual effort.");
            }

            if (mode == ProgressionModes.Preservation && !(source.IsRepRangeTransition && !changed))
            {
                if (goal is null)
                    return Result(load, repeatReps,
                        "Preservation heuristic: an unspecified effort target cannot earn an in-range rep increase. Repeat the load and reps.", rebuilding);

                bool PreservationQualifies(SetExposure exposure)
                    => exposure.Reps >= actual &&
                       ProgressionEvidence.SameLoad(load, selector(exposure)) &&
                       !ProgressionEvidence.Changed(exposure, min, max, goal) &&
                       ProgressionEvidence.Reserve(exposure) is { } expReserve &&
                       expReserve >= goal.Value + 1;

                var qualifyingStreak = ProgressionEvidence.Streak(history, PreservationQualifies);
                if (qualifyingStreak < 2)
                    return Result(load, repeatReps,
                        "Preservation heuristic: hold reps until two consecutive exposures at this load show reserve at least one rep above target effort.", rebuilding);
            }

            var easy = ProgressionCalibration.Applies(mode, source, goal, repsOnly);
            var nextReps = Math.Min(upper, actual + (easy ? ProgressionCalibration.RepGain(reserve!.Value, goal!.Value) : 1));
            var transition = source.IsRepRangeTransition && !changed && nextReps < lower;
            return Result(load, nextReps, transition
                ? $"Rebuild after the large equipment step: aim for {nextReps} reps, then work back into the prescribed range."
                : mode == ProgressionModes.Preservation
                    ? $"Preservation heuristic: two consecutive exposures showed reserve above target effort; aim for {nextReps} reps."
                    : $"Same load, one more rep: {nextReps}.", transition);
        }

        if (!loads.Adjustable || repsOnly || load is null)
            return Result(load, upper, "Top of the range with no adjustable load. Keep building reps or control the tempo.");
        if (!open && qualified < required)
            return Result(load, upper, $"Top of the range reached. Earn {required - qualified} more qualified exposures at this load before increasing it.");

        var increased = loads.Next(load.Value);
        if (!open && ProgressionCalibration.Applies(mode, source, goal, repsOnly) &&
            ProgressionCalibration.Load(source, load.Value, goal!.Value, lower, loads) is { } jump && jump > increased)
        {
            var calibrated = ProgressionEvidence.RepsAt(source, load, jump, goal) ?? lower;
            return Result(jump, Math.Clamp(calibrated, lower, upper),
                "That set was well within reach of the target effort: a larger, capped step to reach it. Reps are estimated; adjust from actual effort.");
        }
        var predictedReps = ProgressionEvidence.RepsAt(source, load, increased, goal);
        if (increased <= load || predictedReps is null)
            return Result(load, upper, "Hold the load: the next available step cannot be estimated reliably from this set.");

        if (!open && predictedReps == lower - 1 && load > 0 && increased / load <= 1.1)
            return Result(increased, lower, "Increase one equipment step; aim for the prescribed minimum at the intended effort.");

        // A bounded exception applies only after earning the top of a genuine range. Missing
        // effort or very large jumps cannot justify asking for implausibly low reps.
        var transitionFloor = Math.Min(lower, Math.Max(6, (int)Math.Ceiling(lower * .6)));
        var allowedTransition = !open && lower < upper && reserve is not null && predictedReps < lower && predictedReps >= transitionFloor;
        if (predictedReps < lower && !allowedTransition)
        {
            // For an exact target, one extra rep is a progression attempt, not a promise.
            if (!open && lower == upper && predictedReps >= lower - 1)
                return Result(increased, lower, "Increase one equipment step; aim to rebuild the exact rep target at the prescribed effort.");
            return Result(load, upper, "Hold the load: the smallest available increase is too large for the current rep target. Build reserve first.");
        }
        if (allowedTransition)
            return Result(increased, predictedReps.Value,
                $"The smallest equipment step is large: aim for about {predictedReps} reps at the intended effort, then rebuild into {lower}–{upper} reps.", true);
        return Result(increased, Math.Clamp(predictedReps.Value, lower, upper),
            $"Increase one equipment step after {required} qualified exposure{(required == 1 ? "" : "s")}. Reps are estimated; adjust from actual effort.");
    }
}
