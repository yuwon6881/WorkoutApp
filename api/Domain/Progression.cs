namespace Workout.Api.Domain;

/// One working set as it was actually performed. A null field is genuinely unknown and never
/// stands in for zero.
public record PreviousSet(double? WeightKg, int? Reps, double? Rpe);

/// What the app carries between sessions for one exercise. Everything here is derived from
/// completed sets, so a lost row costs a suggestion, never history.
public record ProgressionState(double TrendE1rmKg, double LastE1rmKg, int Stalls);

/// The load change and rep goal for the next session, plus the sentence the user reads. The
/// delta is absolute kilograms so back-off sets keep their spacing under the top set.
public record ProgressionPlan(double DeltaKg, int TargetReps, string Reason, double? SuggestedTopKg);

/// Progression is derived, never stored as a prescription: a program still owns what it wrote,
/// and this decides only the load and the rep goal the plan left open.
public static class Progression
{
    public const double DefaultStepKg = 2.5;
    /// Epley holds to roughly ten hard reps; past that an estimate is a guess wearing a number.
    public const int MaxEstimatedReps = 12;
    /// Below RPE 6 the lifter has too many reps left for the estimate to mean anything.
    public const double MinEstimatedRpe = 6;
    /// How much one session moves the running estimate. A single fluke should nudge, not shove.
    public const double TrendWeight = 0.3;
    private const double DeloadFactor = 0.9;
    private const int StallsBeforeDeload = 2;

    /// Epley extended with reps in reserve: the set is rated as if it had been carried to
    /// failure, so a set stopped early still says something about strength. Returns null when
    /// the set cannot honestly support an estimate rather than inventing one.
    public static double? E1rm(double? weightKg, int? reps, double? rpe)
    {
        if (weightKg is not { } weight || reps is not { } count || rpe is not { } effort) return null;
        if (weight <= 0 || count <= 0 || effort < MinEstimatedRpe) return null;
        var total = count + (10 - effort);
        if (total > MaxEstimatedReps) return null;
        return weight * (1 + total / 30);
    }

    public static double? E1rm(PreviousSet set) => E1rm(set.WeightKg, set.Reps, set.Rpe);

    /// Loads land on what the gym actually has. A zero step means the load is not adjustable at
    /// all, so that exercise progresses by reps only.
    public static double RoundToStep(double value, double stepKg)
        => stepKg <= 0 ? value : Math.Round(value / stepKg, MidpointRounding.AwayFromZero) * stepKg;

    /// The smallest sensible jump for a piece of equipment. Unlabelled catalog rows are treated
    /// as barbell work, which is what the seed leaves blank.
    public static double StepForEquipment(string? equipment) => (equipment ?? "").Trim().ToLowerInvariant() switch
    {
        "bodyweight" => 0,
        "band" => 0,
        "dumbbell" => 2,
        "kettlebell" => 4,
        "plate" => 1.25,
        _ => DefaultStepKg
    };

    /// The strongest honest estimate a session produced for one exercise, or null when none of
    /// its sets could support one.
    public static double? SessionE1rm(IEnumerable<PreviousSet> sets)
    {
        double? best = null;
        foreach (var set in sets)
            if (E1rm(set) is { } estimate && (best is null || estimate > best)) best = estimate;
        return best;
    }

    public static ProgressionState Advance(ProgressionState? current, double sessionE1rmKg)
    {
        if (current is null) return new ProgressionState(sessionE1rmKg, sessionE1rmKg, 0);
        var trend = TrendWeight * sessionE1rmKg + (1 - TrendWeight) * current.TrendE1rmKg;
        var stalls = sessionE1rmKg >= current.TrendE1rmKg ? 0 : current.Stalls + 1;
        return new ProgressionState(trend, sessionE1rmKg, stalls);
    }

    /// Double progression gated by effort: reps climb through the prescribed range first, then
    /// the load moves and reps reset. RPE decides how fast that walk goes, and a hard or missed
    /// session holds rather than pushes. The rep goal is always clamped back into the range the
    /// plan asked for, so this can never contradict the program.
    public static ProgressionPlan Next(int repMin, int repMax, double? targetRpe, List<PreviousSet> previous, ProgressionState? state, double stepKg)
    {
        var top = Top(previous);
        if (top is null || top.WeightKg is not { } lastWeight || top.Reps is not { } lastReps)
            return new ProgressionPlan(0, repMin, "First time through. Log what you actually lift.", null);

        var goal = targetRpe ?? 8;
        // Without an effort rating there is no reading on how hard it was, so the load repeats.
        if (top.Rpe is not { } lastRpe)
            return new ProgressionPlan(0, Math.Clamp(lastReps, repMin, repMax), "Same as last time. No effort rating was recorded.", lastWeight);

        return Decide(repMin, repMax, lastWeight, lastReps, lastRpe, goal, goal - lastRpe, state?.Stalls ?? 0, stepKg);
    }

    private static ProgressionPlan Decide(int repMin, int repMax, double lastWeight, int lastReps, double lastRpe, double goal, double headroom, int stalls, double stepKg)
    {
        if (lastReps < repMin || headroom <= -1)
            return stalls >= StallsBeforeDeload && stepKg > 0
                ? new ProgressionPlan(RoundToStep(lastWeight * DeloadFactor, stepKg) - lastWeight, repMin,
                    $"Lighter week. This lift has not moved for {stalls} sessions, so back off about {Math.Round((1 - DeloadFactor) * 100)}% and build again.", null)
                : new ProgressionPlan(0, Math.Clamp(lastReps, repMin, repMax),
                    $"Repeat {Show(lastWeight)} kg. Last time landed at RPE {Show(lastRpe)} against a target of {Show(goal)}.", lastWeight);

        if (lastReps >= repMax && stepKg <= 0)
            return new ProgressionPlan(0, repMax, "Top of the range with no load to add. Add a set or slow the tempo.", lastWeight);

        if (lastReps >= repMax && headroom >= 1)
            return new ProgressionPlan(stepKg * 2, repMin, $"Up {Show(stepKg * 2)} kg. You finished the range at RPE {Show(lastRpe)} with reps to spare.", lastWeight + stepKg * 2);

        if (lastReps >= repMax)
            return new ProgressionPlan(stepKg, repMin, $"Up {Show(stepKg)} kg. You finished the rep range, so reps reset to {repMin}.", lastWeight + stepKg);

        if (headroom >= 0)
        {
            var next = Math.Min(lastReps + 1, repMax);
            return new ProgressionPlan(0, next, $"Same weight, {next} reps. You had effort left at {lastReps}.", lastWeight);
        }

        return new ProgressionPlan(0, Math.Clamp(lastReps, repMin, repMax), $"Repeat {Show(lastWeight)} kg. That was a little harder than the plan asked for.", lastWeight);
    }

    /// The set that best represents the session: the strongest estimate where one exists, and
    /// otherwise the heaviest completed set.
    private static PreviousSet? Top(List<PreviousSet> previous)
    {
        PreviousSet? best = null;
        var bestScore = double.NegativeInfinity;
        foreach (var set in previous)
        {
            if (set.WeightKg is null || set.Reps is null) continue;
            var score = E1rm(set) ?? set.WeightKg.Value;
            if (score > bestScore) { bestScore = score; best = set; }
        }
        return best;
    }

    private static string Show(double value) => value.ToString("0.##");
}
