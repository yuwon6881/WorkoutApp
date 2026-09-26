using System.Text.RegularExpressions;

namespace Workout.Api.Domain;

/// One working set as it was actually performed. A null field is genuinely unknown and never
/// stands in for zero.
public record PreviousSet(double? WeightKg, int? Reps, double? Rpe);

/// A historical exposure for one working-set ordinal. The list supplied to the policy is newest
/// first, bounded to thirty completed sessions, with each session's prescription and effort.
public sealed record SetExposure(
    Guid SessionId,
    DateTime CompletedAt,
    double? LoadKg,
    int? Reps,
    double? Rpe,
    double? SystemLoadKg = null,
    string ResistanceMode = ResistanceModes.External,
    string? Rir = null,
    int? RepMin = null,
    int? RepMax = null,
    double? TargetRpe = null,
    string? TargetRir = null,
    bool IsRepRangeTransition = false,
    bool HasPrescription = false);

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
    string ResistanceMode = ResistanceModes.External,
    bool IsRepRangeTransition = false);

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
    private static readonly Regex OpenReps = new(@"\b(?:amrap|max(?:imum)?\s+reps?|to\s+failure|failure)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// A set printed as "AMRAP" with no count. Its stored bounds are only the one-rep placeholder a
    /// set must carry, so it has no rep target to suggest or prefill: the lifter logs what they get.
    public static bool HasOpenReps(string? repsText)
        => !string.IsNullOrWhiteSpace(repsText) && OpenReps.IsMatch(repsText) && !repsText.Any(char.IsDigit);

    public static SetProgressionSuggestion ForPrescription(SetPrescription prescription, SetProgressionSuggestion suggestion)
        => HasOpenReps(prescription.RepsText) ? suggestion with { Reason = "As many reps as possible: log the reps you get. " + suggestion.Reason }
            : prescription.RepMin is null ? suggestion with { Reason = "No rep target is set: log the reps you do. " + suggestion.Reason }
            : suggestion;

    /// Neither an open set nor one with no rep target is prefilled with a count it never asked for.
    public static int? PrefillReps(SetPrescription prescription, SetProgressionSuggestion suggestion)
        => HasOpenReps(prescription.RepsText) || prescription.RepMin is null ? null : suggestion.SuggestedReps;

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

    public static SetProgressionSuggestion Suggest(
        SetPrescription prescription, IReadOnlyList<SetExposure> history, string mode, LoadOptions loads,
        long? revision = null, string resistanceMode = ResistanceModes.External,
        Func<SetExposure, double?>? selectLoad = null)
        => PrescriptionProgression.Suggest(prescription, history, mode, loads, revision, resistanceMode, selectLoad);

    /// Compatibility entry point for callers with explicit rep bounds.
    public static SetProgressionSuggestion SuggestSet(
        int repMin, int repMax, double? targetRpe, IReadOnlyList<SetExposure> latestExposures,
        string progressionMode, double stepKg, long? nutritionContextRevision = null,
        string resistanceMode = ResistanceModes.External, Func<SetExposure, double?>? suggestedLoad = null)
        => Suggest(new SetPrescription(repMin, repMax, targetRpe, null, null, null, null), latestExposures,
            progressionMode, new LoadOptions(stepKg), nutritionContextRevision, resistanceMode, suggestedLoad);
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

}
