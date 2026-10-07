namespace Workout.Api.Domain;

/// A bodyweight reference is frozen with the workout. Historical records without one remain
/// unavailable for bodyweight-derived strength metrics rather than being reconstructed later.
public sealed record BodyWeightSnapshot(
    double? ScaleKg,
    DateOnly? ScaleDate,
    double? TrendKg,
    DateOnly? TrendDate,
    double? ReferenceKg,
    string? ReferenceSource,
    DateOnly? ReferenceDate,
    string CalculationVersion,
    long? NutritionRevision,
    DateTime CapturedAt);

public sealed record NutritionTrainingContext(
    string? Subject,
    long Revision,
    string TimeZone,
    string EffectiveGoal,
    bool PhaseComplete,
    double? TargetRatePercent,
    double? ObservedLossRatePercent,
    int? ObservedWindowDays,
    double? ScaleWeightKg,
    DateOnly? ScaleWeightDate,
    double? TrendWeightKg,
    DateOnly? TrendWeightDate,
    DateTime RetrievedAt,
    bool Confirmed,
    string? Error = null,
    bool Cached = false);

public sealed record IntegrationGrantView(string Peer, string Status, DateTime? GrantedAt, DateTime? RevokedAt);

public sealed record WorkoutTrainingSummary(
    string Id,
    string Status,
    DateOnly LocalDate,
    DateTime? StartedAt,
    DateTime? FinishedAt,
    string WorkoutName,
    IReadOnlyList<string> MuscleGroups,
    int WorkingSetCount,
    double? ExternalVolumeKg,
    double? SystemVolumeKg,
    double? AverageRpe,
    bool Completed = true,
    DateOnly? ActualDate = null,
    DateOnly? CompletionDate = null,
    int? RepWorkingSets = null,
    int? TimedWorkingSets = null,
    int? DurationSeconds = null,
    int? EffortRecordedSets = null,
    bool? EffortTracked = null,
    IReadOnlyList<string>? ExerciseMix = null,
    bool? ExternalVolumeComplete = null,
    bool? SystemVolumeComplete = null,
    int? ProgramWeek = null,
    int? ProgramPosition = null);

public static class LoadModels
{
    public const string External = "external";
    public const string FullBodyweight = "full_bodyweight";
    public const string BodyweightContextOnly = "bodyweight_context_only";
    public const string RepsOnly = "reps_only";
    public static readonly string[] All = [External, FullBodyweight, BodyweightContextOnly, RepsOnly];

    /// Entered load is never a substitute for missing frozen body mass, nor a strength
    /// measurement for movements tracked only by reps or bodyweight context.
    public static double? ComparableLoad(string loadModel, double? enteredKg, double? systemKg)
        => loadModel switch
        {
            External => enteredKg,
            FullBodyweight => systemKg,
            _ => null
        };
}

/// How a set of an exercise is measured. Timed holds (planks, hangs, carries) record seconds
/// instead of reps and never enter the rep-based progression or strength records.
public static class TrackingModes
{
    public const string Reps = "reps";
    public const string Duration = "duration";
    public static readonly string[] All = [Reps, Duration];
    public static string Normalize(string? value) => value == Duration ? Duration : Reps;
}

public static class ExerciseCategories
{
    public const string FreeWeights = "Free Weights";
    public const string Machine = "Machine";
    public const string BodyWeight = "Body Weight";
    public static readonly string[] All = [FreeWeights, Machine, BodyWeight];

    public static string Normalize(string? value, string? equipment = null, string? loadModel = null)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            var trimmed = value.Trim();
            if (trimmed.Equals(FreeWeights, StringComparison.OrdinalIgnoreCase)
                || trimmed.Equals("Free Weight", StringComparison.OrdinalIgnoreCase)
                || trimmed.Equals("Freeweights", StringComparison.OrdinalIgnoreCase))
                return FreeWeights;
            if (trimmed.Equals(Machine, StringComparison.OrdinalIgnoreCase)
                || trimmed.Equals("Machines", StringComparison.OrdinalIgnoreCase))
                return Machine;
            if (trimmed.Equals(BodyWeight, StringComparison.OrdinalIgnoreCase)
                || trimmed.Equals("Bodyweight", StringComparison.OrdinalIgnoreCase))
                return BodyWeight;
        }

        var eq = (equipment ?? "").Trim().ToLowerInvariant();
        if (eq is "bodyweight" or "band"
            || loadModel is LoadModels.FullBodyweight or LoadModels.BodyweightContextOnly or LoadModels.RepsOnly)
            return BodyWeight;
        if (eq is "machine" or "smith machine" or "cable")
            return Machine;
        return FreeWeights;
    }
}
