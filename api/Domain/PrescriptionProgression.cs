namespace Workout.Api.Domain;

internal static class PrescriptionProgression
{
    public static SetProgressionSuggestion Suggest(
        SetPrescription prescription, IReadOnlyList<SetExposure> history, string progressionMode,
        LoadOptions loads, long? revision, string resistanceMode, Func<SetExposure, double?>? selectLoad, DateTime? now = null,
        DateTime? lastTrained = null)
    {
        var mode = ProgressionModes.All.Contains(progressionMode) ? progressionMode : ProgressionModes.Normal;
        var selector = selectLoad ?? (exposure => exposure.LoadKg);
        var open = Progression.HasOpenReps(prescription.RepsText) || prescription.RepMin is null;
        var min = open ? (int?)null : prescription.RepMin;
        var max = open ? (int?)null : prescription.RepMax ?? min;
        var goal = ProgressionEvidence.Reserve(prescription.Rir, prescription.TargetRpe);
        // A set only learns from sets done the same way: a partial or myo-rep set says nothing
        // about the straight set in its slot, and the reverse.
        // Time away counts every session of the movement, whatever technique it used.
        var away = ProgressionLayoff.Days(lastTrained ?? ProgressionLayoff.Newest(history), now);
        // Time away only ever eases a suggestion: what the set would be given had the lift been
        // trained through is the most a layoff may ask for.
        var trainedThrough = away is >= ProgressionLayoff.HoldDays
            ? Suggest(prescription, history, progressionMode, loads, revision, resistanceMode, selectLoad)
            : null;
        var technique = SetTechniques.Of(prescription);
        history = history.Where(exposure => exposure.Technique == technique).ToList();
        history = ProgressionHistory.Prepare(history, min, max, goal);
        var source = history.FirstOrDefault();
        var load = source is null ? null : selector(source);
        var repsOnly = resistanceMode == ResistanceModes.RepsOnly;

        SetProgressionSuggestion Result(double? weight, int reps, string reason, bool transition = false)
            => new(repsOnly ? null : weight, reps, reason,
                source?.SessionId == Guid.Empty ? null : source?.SessionId,
                source?.CompletedAt == DateTime.MinValue ? null : source?.CompletedAt,
                mode, revision, false, selectLoad is null ? null : weight, resistanceMode, transition,
                PreviousLoadKg: repsOnly ? null : load, PreviousReps: source?.Reps);

        if (source?.Reps is not { } actual || load is null && !repsOnly)
            return Result(null, min ?? 0, repsOnly ? "First time through. Log actual reps and effort."
                : "First time through. Enter the load you actually use.");

        var reserve = ProgressionEvidence.Reserve(source);
        var lower = min ?? actual;
        var upper = max ?? actual;
        var changed = ProgressionEvidence.Changed(source, min, max, goal);
        var rebuilding = source.IsRepRangeTransition && !changed && actual < lower;
        var repeatReps = rebuilding ? actual : Math.Clamp(actual, lower, upper);

        if (away is >= ProgressionLayoff.HoldDays)
        {
            // Repeating the last session means its reps too: a set that fell short of the range is
            // not asked for the full minimum straight after a break.
            var heldReps = Math.Min(actual, upper);
            if (away < ProgressionLayoff.ReduceDays)
                return Easier(trainedThrough!, load, heldReps, away.Value)
                    ?? Result(load, heldReps, $"Back after {away} days away: repeat your last session before progressing.", rebuilding);
            var factor = ProgressionLayoff.Factor(away.Value);
            var eased = load is { } current && loads.Adjustable && !repsOnly ? Math.Min(current, loads.AtMost(current * factor)) : load;
            if (Easier(trainedThrough!, eased, lower, away.Value) is { } easier) return easier;
            // Only claim a lighter load when one exists: a reps-only movement or the lightest available
            // weight eases in through the reps alone.
            return Result(eased, lower, eased is { } lighter && load is { } before && lighter < before
                ? $"Back after {away} days away: about {(int)Math.Round((1 - lighter / before) * 100)}% lighter to rebuild."
                : $"Back after {away} days away: ease back in at the bottom of the range before progressing.");
        }

        // Changing the program's targets is not a failed exposure. Re-select a suitable load
        // before evaluating streaks against the new prescription.
        // An unrecorded effort is read as the target the set was asked for, so a periodised program
        // still re-selects its load when RIR is not tracked.
        var assumed = ProgressionEvidence.AssumedReserve(source, goal);
        if (changed && assumed is not null && load is > 0 && loads.Adjustable && !repsOnly &&
            ProgressionEvidence.Capacity(source, load, assumed) is { } capacity)
        {
            var predicted = ProgressionEvidence.RepsAt(source, load, load.Value, goal);
            if (predicted < lower - 1 || predicted > upper + 1)
            {
                var selected = loads.AtMost(capacity / (30 + lower + (goal ?? assumed.Value)));
                if (selected > 0)
                {
                    var estimate = ProgressionEvidence.RepsAt(source, load, selected, goal) ?? lower;
                    return Result(selected, Math.Clamp(estimate, lower, upper),
                        "Prescription changed: estimated load and reps for the new target. Adjust from actual effort.");
                }
            }
        }

        // A dip caused by earlier sets being pushed too hard is not this set getting weaker: hold the
        // load and aim for what the set managed the last time it started fresh.
        var fatigue = changed ? FatigueReading.None : ProgressionFatigue.Read(history, min, goal, selector);
        if (fatigue.Excused.Contains(source))
        {
            var freshReps = !rebuilding && fatigue.Fresh?.Reps is { } best &&
                ProgressionEvidence.SameLoad(load, selector(fatigue.Fresh)) ? Math.Clamp(best, lower, upper) : repeatReps;
            return Result(load, freshReps, fatigue.PastTarget
                ? $"An earlier set went past its target effort last time, so this set's dip reflects carried-over fatigue, not lost strength. Repeat the load for {freshReps} reps and keep earlier sets at their target effort."
                : $"Earlier sets were pushed closer to failure than the session before, so this set's dip reflects carried-over fatigue, not lost strength. Repeat the load for {freshReps} reps.",
                rebuilding);
        }

        var hardStreak = changed ? 0 : ProgressionEvidence.Streak(history,
            exposure => !ProgressionEvidence.Changed(exposure, min, max, goal) &&
                !fatigue.Excused.Contains(exposure) &&
                ProgressionEvidence.Hard(exposure, lower, goal));
        // A set pushed past its target says how many reps the load really allows: aim there, or
        // lighter, rather than asking for the same reps that already cost too much. A program that
        // prints no effort is aimed at the default reserve the logger offers, once the set logged its
        // own: otherwise a set far short of the minimum would repeat its load for the full count.
        var assumedTarget = goal is null && reserve is not null;
        var aimed = rebuilding || (goal ?? (assumedTarget ? EffortPrefill.DefaultReserve : null)) is not { } target ? null
            : ProgressionRetarget.Aim(source, load, lower, upper, target, loads, repsOnly);
        if (hardStreak > 0)
        {
            if (aimed is not null && (hardStreak == 1 || !loads.Adjustable || repsOnly))
                return Result(aimed.LoadKg, aimed.Reps, ProgressionRetarget.Reason(aimed, load, assumedTarget));
            if (!loads.Adjustable || repsOnly)
                return Result(load, repeatReps, "No adjustable load: repeat the reps and use an easier variation if needed to match the intended effort.", rebuilding);
            if (hardStreak == 1)
                return Result(load, repeatReps, rebuilding
                    ? "Hold the transition reps after a hard exposure; match the intended effort before rebuilding."
                    : "Repeat the reps after a hard exposure; match the intended effort before progressing.", rebuilding);
            if (hardStreak == 2)
            {
                // Never heavier than what the last set itself says the target needs.
                var stepped = load is { } weight ? loads.Previous(weight) : (double?)null;
                if (aimed?.LoadKg is { } estimate && stepped is { } step && estimate < step) stepped = estimate;
                return Result(stepped, lower, "One equipment step lighter after two hard exposures.");
            }
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
            ProgressionCalibration.Plateaued(history.Where(exposure => !fatigue.Excused.Contains(exposure)).ToList(),
                load, goal, selector))
        {
            // A deficit does not stop strength from rising, but a reset would cost the training
            // intensity that protects muscle: keep the load and keep asking for overload.
            if (mode != ProgressionModes.Normal)
            {
                var attempt = Math.Min(upper, actual + 1);
                return Result(load, attempt,
                    $"No rep gain in {ProgressionCalibration.PlateauSessions} sessions at this load. During a calorie deficit the load holds rather than resets: aim for one more rep, {attempt}.", rebuilding);
            }
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
            return aimed is not null
                ? Result(aimed.LoadKg, aimed.Reps, ProgressionRetarget.Reason(aimed, load, assumedTarget))
                : Result(load, repeatReps, "Repeat the last load and reps. The exposure was not within the target effort range.", rebuilding);

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

            // A steep deficit slows overload rather than stopping it: each new rep is repeated once at
            // the target effort before the next is asked for, unless the set was clearly easier than
            // its target. Strength can still rise in a deficit, so the lifter keeps progressing at
            // about half the normal rep pace.
            var preserving = mode == ProgressionModes.Preservation && !(source.IsRepRangeTransition && !changed);
            var easier = goal is { } aim && reserve >= aim + 1;
            if (preserving && !easier && ProgressionEvidence.Streak(history, exposure =>
                    exposure.Reps >= actual && ProgressionEvidence.SameLoad(load, selector(exposure)) &&
                    !ProgressionEvidence.Changed(exposure, min, max, goal) &&
                    ProgressionEvidence.MeetsEffort(exposure, goal)) < 2)
                return Result(load, repeatReps,
                    $"Calorie deficit: repeat {repeatReps} reps at this load once more to consolidate them, then add a rep.", rebuilding);

            var easy = ProgressionCalibration.Applies(mode, source, goal, repsOnly);
            var nextReps = Math.Min(upper, actual + (easy ? ProgressionCalibration.RepGain(reserve!.Value, goal!.Value) : 1));
            var transition = source.IsRepRangeTransition && !changed && nextReps < lower;
            return Result(load, nextReps, transition
                ? $"Rebuild after the large equipment step: aim for {nextReps} reps, then work back into the prescribed range."
                : preserving
                    ? easier
                        ? $"Calorie deficit: the last set was easier than its target, so add a rep: {nextReps}."
                        : $"Calorie deficit: these reps held twice at the target effort, so add a rep: {nextReps}."
                    : $"Same load, one more rep: {nextReps}.", transition);
        }

        if (!loads.Adjustable || repsOnly || load is null)
            return Result(load, upper, "Top of the range with no adjustable load. Keep building reps or control the tempo.");
        if (!open && qualified < required)
            return Result(load, upper, $"Top of the range reached. Earn {required - qualified} more qualified exposures at this load before increasing it.");

        var increased = loads.Next(load.Value);
        if (!open && ProgressionCalibration.Applies(mode, source, goal, repsOnly, upper) &&
            ProgressionCalibration.Load(source, load.Value, goal!.Value, lower, loads) is { } jump && jump > increased)
        {
            var calibrated = ProgressionEvidence.RepsAt(source, load, jump, goal) ?? lower;
            return Result(jump, Math.Clamp(calibrated, lower, upper),
                "That set was well within reach of the target effort: a larger, capped step to reach it. Reps are estimated; adjust from actual effort.");
        }
        var predictedReps = ProgressionEvidence.RepsAt(source, load, increased, goal);
        if (increased <= load)
            return Result(load, upper, "Top of the range at the heaviest available weight: keep building reps or control the tempo.");
        if (predictedReps is null)
        {
            // Past 30 effective reps the estimate no longer holds, but a high-rep set at the top of
            // its range has earned a small step as surely as any other.
            if (!open && increased / load <= 1.1)
                return Result(increased, lower, "Increase one equipment step; aim for the bottom of the range at the intended effort.");
            return Result(load, upper, "Hold the load: the next available step cannot be estimated reliably from this set.");
        }

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
            // Reps capped at the top of the range can never show the step is reachable, so the
            // set earns it with reps past the range, one at a time, as far as a bounded overshoot.
            var aimAtStep = lower < upper && reserve is not null ? transitionFloor : lower == upper ? lower - 1 : lower;
            if (!open && ProgressionCalibration.RepsToReach(source, load.Value, increased, aimAtStep, goal, upper) is { } needed)
            {
                var next = Math.Min(Math.Max(actual, upper) + 1, needed);
                return Result(load, next,
                    $"The next available weight is too big a jump from here: aim for {next} reps at this load, past the range, and step up once about {needed} reps are within the target effort.");
            }
            return Result(load, upper, "Hold the load: the next available weight is too big a jump for this rep target. Add a smaller increment in this exercise's weight settings, or move up and log the reps you get.");
        }
        if (allowedTransition)
            return Result(increased, predictedReps.Value,
                $"The smallest equipment step is large: aim for about {predictedReps} reps at the intended effort, then rebuild into {lower}–{upper} reps.", true);
        return Result(increased, Math.Clamp(predictedReps.Value, lower, upper),
            $"Increase one equipment step after {required} qualified exposure{(required == 1 ? "" : "s")}. Reps are estimated; adjust from actual effort.");
    }

    /// The trained-through suggestion when it already asks for less than the layoff would (a lighter
    /// load, or fewer reps at the same load), so a break never makes the next session harder.
    private static SetProgressionSuggestion? Easier(SetProgressionSuggestion trainedThrough, double? load, int reps, int away)
    {
        var lighter = trainedThrough.SuggestedLoadKg is { } suggested && load is { } held && suggested < held - .0001;
        var fewer = ProgressionEvidence.SameLoad(trainedThrough.SuggestedLoadKg, load) && trainedThrough.SuggestedReps < reps;
        return lighter || fewer
            ? trainedThrough with { Reason = $"Back after {away} days away. {trainedThrough.Reason}" }
            : null;
    }
}
