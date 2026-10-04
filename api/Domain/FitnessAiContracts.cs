namespace Fitness.Ai.Contracts;

// Canonical producer/consumer DTOs. Run scripts/sync-fitness-ai.mjs to vendor changes.
public sealed record NutritionTargets(double? Calories, double? Protein, double? Fat, double? Carbs, DateOnly PlanDate);
public sealed record NutritionDailySummary(DateOnly Date, string Status, bool Archived, int EntryCount,
    double? Calories, double? Protein, double? Fat, double? Carbs, double? Fiber, NutritionTargets? Targets,
    double? EstimatedMaintenance, double? Confidence, string? HoldReason, string? MaintenanceSource);
public sealed record NutritionPeriodSummary(DateOnly From, DateOnly To, int CompleteDays, int UnknownIntakeDays,
    int ProteinKnownDays, double? AverageCalories, double? AverageProtein, int TargetComparedDays,
    double? AverageBelowTargetCalories, int MaintenanceComparedDays, double? AverageEstimatedDeficitCalories,
    int ProteinTargetComparedDays, double? AverageBelowProteinTargetGrams,
    IReadOnlyDictionary<string, int>? UnknownCompletedNutrientDays = null);
public sealed record NutritionWeightSummary(int WeighIns, DateOnly? FirstDate, DateOnly? LastDate,
    double? FirstScaleKg, double? LastScaleKg, double? FirstTrendKg, double? LastTrendKg, string TrendMethod,
    DateOnly? FirstTrendDate = null, DateOnly? LastTrendDate = null);
public sealed record NutritionGoalFacts(string EffectiveGoal, bool PhaseComplete, double? TargetRatePercent,
    double? ObservedLossRatePercent, int? ObservedWindowDays);
public sealed record NutritionPeerSummary(string Subject, long Revision, string TimeZone, DateOnly From, DateOnly To,
    DateTime RetrievedAt, string EnergyUnit, NutritionGoalFacts GoalContext, NutritionPeriodSummary Period,
    NutritionWeightSummary Weight, IReadOnlyList<NutritionDailySummary> Days, bool CoachingEligible, string CoachingExplanation);
