namespace Workout.Api.Domain;

/// One working set as it was actually performed. A null field is genuinely unknown and never
/// stands in for zero.
public record PreviousSet(double? WeightKg, int? Reps, double? Rpe);

/// A historical exposure for one working-set ordinal. The list supplied to the policy is newest
/// first and contains the latest hard exposures plus the most recent successful exposure when it
/// is older than those hard exposures.
public sealed record SetExposure(
    Guid SessionId,
    DateTime CompletedAt,
    double? LoadKg,
    int? Reps,
    double? Rpe,
    double? SystemLoadKg = null,
    string ResistanceMode = ResistanceModes.External);

public static class ProgressionModes
{
    public const string Normal = "normal";
    public const string Conservative = "conservative";
    public const string Preservation = "preservation";
    public static readonly string[] All = [Normal, Conservative, Preservation];

    public static int QualifiedExposures(string mode) => mode switch
    {
        Conservative => 2,
        Preservation => 3,
        _ => 1
    };
}

public static class ResistanceModes
{
    public const string External = "external";
    public const string Bodyweight = "bodyweight";
    public const string Added = "added";
    public const string Assistance = "assistance";
    public const string RepsOnly = "reps_only";
    public static readonly string[] All = [External, Bodyweight, Added, Assistance, RepsOnly];
}

/// The immutable suggestion shown when a session starts. It is stored on the planned set rather
/// than recalculated from the current policy when the session is later saved or viewed.
public sealed record SetProgressionSuggestion(
    double? SuggestedLoadKg,
    int SuggestedReps,
    string Reason,
    Guid? SourceSessionId,
    DateTime? SourceDate,
    string ProgressionMode,
    long? NutritionContextRevision,
    bool IsBodyweightAdjustment = false,
    double? SuggestedSystemLoadKg = null,
    string ResistanceMode = ResistanceModes.External);

/// The old exercise estimate is retained for historical exports and strength charts. It is not
/// used to make a set suggestion: adaptive progression is keyed by exercise and working ordinal.
public record ProgressionState(double TrendE1rmKg, double LastE1rmKg, int Stalls);

/// Compatibility DTO for clients that still render the old exercise-level summary. New clients
/// should read SetProgressionSuggestion from each logged set.
public record ProgressionPlan(double DeltaKg, int TargetReps, string Reason, double? SuggestedTopKg);

/// Pure progression policy. Programs prescribe reps and effort; this policy decides only an
/// uncompleted default load/repetition pair from the matching set's recent history.
public static class Progression
{
    public const double DefaultStepKg = 2.5;
    public const int MaxEstimatedReps = 12;
    public const double MinEstimatedRpe = 6;

    private const double DeloadFactor = 0.925;

    /// Epley extended with reps in reserve. Returns null when the set cannot honestly support an
    /// estimate rather than inventing one.
    public static double? E1rm(double? weightKg, int? reps, double? rpe)
    {
        if (weightKg is not { } weight || reps is not { } count || rpe is not { } effort) return null;
        if (weight <= 0 || count <= 0 || effort < MinEstimatedRpe) return null;
        var total = count + (10 - effort);
        if (total > MaxEstimatedReps) return null;
        return weight * (1 + total / 30);
    }

    public static double? E1rm(PreviousSet set) => E1rm(set.WeightKg, set.Reps, set.Rpe);

    /// Estimates 1RM using the scientific Epley formula with optional RIR adjustment.
    /// When effort (RPE >= 6) is known, reps are adjusted to failure (reps + (10 - RPE)).
    /// When RPE is absent, the completed reps are taken as performed.
    /// Caps at 12 effective reps where the Epley relationship is valid.
    public static double? Estimate1Rm(double? weightKg, int? reps, double? rpe = null)
    {
        if (weightKg is not { } weight || reps is not { } count) return null;
        if (weight <= 0 || count <= 0) return null;
        double total;
        if (rpe is { } effort)
        {
            if (effort < MinEstimatedRpe) return null;
            total = count + (10 - effort);
        }
        else
        {
            total = count;
        }
        if (total > MaxEstimatedReps) return null;
        return weight * (1 + total / 30.0);
    }

    /// Round to the nearest available step for legacy displays.
    public static double RoundToStep(double value, double stepKg)
        => stepKg <= 0 ? value : Math.Round(value / stepKg, MidpointRounding.AwayFromZero) * stepKg;

    /// A deload and a compensation target must never invent an equipment size above the value
    /// requested. This is intentionally different from RoundToStep, which rounds to nearest.
    public static double RoundDownToStep(double value, double stepKg)
    {
        if (stepKg <= 0) return value;
        return Math.Floor((value + 1e-9) / stepKg) * stepKg;
    }

    public static double StepForEquipment(string? equipment) => (equipment ?? "").Trim().ToLowerInvariant() switch
    {
        "bodyweight" => 0,
        "band" => 0,
        "dumbbell" => 2,
        "kettlebell" => 4,
        "plate" => 1.25,
        _ => DefaultStepKg
    };

    /// The strongest honest estimate a session produced for one exercise.
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
        var trend = .3 * sessionE1rmKg + .7 * current.TrendE1rmKg;
        var stalls = sessionE1rmKg >= current.TrendE1rmKg ? 0 : current.Stalls + 1;
        return new ProgressionState(trend, sessionE1rmKg, stalls);
    }

    /// Make the suggestion for one working-set ordinal from newest-first history.
    public static SetProgressionSuggestion SuggestSet(
        int repMin,
        int repMax,
        double? targetRpe,
        IReadOnlyList<SetExposure> latestExposures,
        string progressionMode,
        double stepKg,
        long? nutritionContextRevision = null,
        string resistanceMode = ResistanceModes.External,
        Func<SetExposure, double?>? suggestedLoad = null)
    {
        var goal = targetRpe ?? 8;
        var source = latestExposures.FirstOrDefault();
        var mode = ProgressionModes.All.Contains(progressionMode) ? progressionMode : ProgressionModes.Normal;
        var required = ProgressionModes.QualifiedExposures(mode);
        var loadSelector = suggestedLoad ?? (exposure => exposure.LoadKg);
        double? outputLoad(double? value) => resistanceMode == ResistanceModes.RepsOnly ? null : value;
        var sourceLoad = source is null ? null : loadSelector(source);

        if (source is null || source.Reps is not { } sourceReps || sourceLoad is null && resistanceMode != ResistanceModes.RepsOnly)
            return New(null, repMin, "First time through. Enter the load you actually use.", null, mode, nutritionContextRevision, resistanceMode);

        if (source.Rpe is null)
            return New(outputLoad(loadSelector(source)), ClampReps(sourceReps, repMin, repMax),
                "Repeat the last load and reps. No actual RPE was recorded, so progression is on hold.", source, mode,
                nutritionContextRevision, resistanceMode);

        if (IsHard(source, repMin, goal))
        {
            var hardStreak = Consecutive(latestExposures, exposure => IsHard(exposure, repMin, goal));
            var load = loadSelector(source);
            if (hardStreak == 1)
                return New(outputLoad(load), repMin, "Repeat the prescribed minimum after a hard exposure.", source, mode,
                    nutritionContextRevision, resistanceMode);
            if (hardStreak == 2)
                return New(outputLoad(Reduce(load, stepKg)), repMin, "One equipment step lighter after two hard exposures.", source, mode,
                    nutritionContextRevision, resistanceMode);

            var successful = latestExposures.FirstOrDefault(exposure => IsSuccessful(exposure, repMin, goal) && loadSelector(exposure) is not null);
            var deloadFrom = loadSelector(successful ?? source);
            var deload = deloadFrom is { } value ? (double?)RoundDownToStep(Math.Max(0, value * DeloadFactor), stepKg) : null;
            return New(outputLoad(deload), repMin, "Three hard exposures in a row. Deload 7.5% from the last successful load and rebuild.", source,
                mode, nutritionContextRevision, resistanceMode);
        }

        // A missing/neutral effort resets both streaks. Only a real success may advance reps.
        if (!IsSuccessful(source, repMin, goal))
            return New(outputLoad(loadSelector(source)), ClampReps(sourceReps, repMin, repMax),
                "Repeat the last load and reps. The exposure was not within the target effort range.", source, mode,
                nutritionContextRevision, resistanceMode);

        if (sourceReps < repMax)
        {
            var nextReps = Math.Min(repMax, sourceReps + 1);
            return New(outputLoad(loadSelector(source)), nextReps, $"Same load, one more rep: {nextReps}.", source, mode,
                nutritionContextRevision, resistanceMode);
        }

        var qualifiedStreak = ConsecutiveQualified(latestExposures, repMax, goal, loadSelector);
        if (stepKg <= 0 || resistanceMode == ResistanceModes.RepsOnly)
            return New(outputLoad(loadSelector(source)), repMax, "Top of the range with no adjustable load. Keep building reps or control the tempo.", source,
                mode, nutritionContextRevision, resistanceMode);
        if (qualifiedStreak < required)
            return New(outputLoad(loadSelector(source)), repMax,
                required == 1 ? "Top of the range reached. The next load step is earned." :
                $"Top of the range reached. Earn {required - qualifiedStreak} more qualified exposure{(required - qualifiedStreak == 1 ? "" : "s")} at this load before increasing it.",
                source, mode, nutritionContextRevision, resistanceMode);

        var increased = loadSelector(source) is { } current ? Math.Max(0, RoundToStep(current + stepKg, stepKg)) : (double?)null;
        return New(outputLoad(increased), repMin, $"Increase one equipment step after {required} qualified exposure{(required == 1 ? "" : "s")}.", source,
            mode, nutritionContextRevision, resistanceMode);
    }

    /// Kept for the old export/chart contract. It now follows the same one-step policy as the
    /// per-set engine and never performs an easy-session double jump.
    public static ProgressionPlan Next(int repMin, int repMax, double? targetRpe, List<PreviousSet> previous,
        ProgressionState? state, double stepKg)
    {
        var exposures = previous.Select(set => new SetExposure(Guid.Empty, DateTime.MinValue, set.WeightKg, set.Reps, set.Rpe)).ToList();
        var suggestion = SuggestSet(repMin, repMax, targetRpe, exposures, ProgressionModes.Normal, stepKg);
        var last = previous.FirstOrDefault()?.WeightKg;
        var delta = suggestion.SuggestedLoadKg is { } next && last is { } old ? next - old : 0;
        return new ProgressionPlan(delta, suggestion.SuggestedReps, suggestion.Reason, suggestion.SuggestedLoadKg);
    }

    private static SetProgressionSuggestion New(double? load, int reps, string reason, SetExposure? source, string mode,
        long? revision, string resistanceMode)
        => new(load, reps, reason, source?.SessionId == Guid.Empty ? null : source?.SessionId,
            source?.CompletedAt == DateTime.MinValue ? null : source?.CompletedAt, mode, revision,
            false, source?.SystemLoadKg, resistanceMode);

    private static double? Reduce(double? load, double step)
        => load is { } value ? Math.Max(0, RoundDownToStep(value - step, step)) : null;

    private static int ClampReps(int reps, int repMin, int repMax)
        => Math.Clamp(reps, repMin, repMax);

    private static bool IsHard(SetExposure exposure, int repMin, double targetRpe)
        => exposure.Reps is { } reps && reps < repMin || exposure.Rpe is { } rpe && rpe >= targetRpe + 1;

    private static bool IsSuccessful(SetExposure exposure, int repMin, double targetRpe)
        => exposure.Reps is { } reps && reps >= repMin && exposure.Rpe is { } rpe && rpe <= targetRpe;

    private static int Consecutive(IEnumerable<SetExposure> exposures, Func<SetExposure, bool> predicate)
    {
        var count = 0;
        foreach (var exposure in exposures)
        {
            if (!predicate(exposure)) break;
            count++;
        }
        return count;
    }

    private static int ConsecutiveQualified(IReadOnlyList<SetExposure> exposures, int repMax, double targetRpe,
        Func<SetExposure, double?> loadSelector)
    {
        var first = exposures.FirstOrDefault();
        if (first is null || !IsQualified(first, repMax, targetRpe)) return 0;
        var firstLoad = loadSelector(first);
        var count = 0;
        foreach (var exposure in exposures)
        {
            var load = loadSelector(exposure);
            if (!IsQualified(exposure, repMax, targetRpe) || !SameLoad(firstLoad, load)) break;
            count++;
        }
        return count;
    }

    private static bool IsQualified(SetExposure exposure, int repMax, double targetRpe)
        => exposure.Reps is { } reps && reps >= repMax && exposure.Rpe is { } rpe && rpe <= targetRpe;

    private static bool SameLoad(double? left, double? right)
        => left is null && right is null || left is { } l && right is { } r && Math.Abs(l - r) < .0001;
}
