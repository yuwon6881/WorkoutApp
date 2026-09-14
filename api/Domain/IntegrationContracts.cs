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
    bool Completed = true);

public static class LoadModels
{
    public const string External = "external";
    public const string FullBodyweight = "full_bodyweight";
    public const string BodyweightContextOnly = "bodyweight_context_only";
    public const string RepsOnly = "reps_only";
    public static readonly string[] All = [External, FullBodyweight, BodyweightContextOnly, RepsOnly];
}
