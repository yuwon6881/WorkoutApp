using System.Text.Json.Nodes;

namespace Workout.Api.Services.AI.Tools;

public sealed class GetNutritionSummaryTool(NutritionSummaryService nutrition) : IAiTool
{
    public string Name => "get_nutrition_summary";
    public string Description => "Read linked Nutrition intake, accepted targets, estimated maintenance, protein coverage, and cleaned weights. Below target is not a deficit. Includes source dates and freshness.";
    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject { ["days"] = new JsonObject { ["type"] = "integer", ["description"] = "Recent nutrition days, 1-28, default 14." } }
    };
    public string ProgressLabel(AiToolArgs args) => "Checking linked nutrition evidence...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken ct)
    {
        var days = args.OptionalInt("days", 1, 28) ?? 14;
        var result = await nutrition.Get(days, ct);
        var summary = result.Summary;
        return AiToolResult.Of(new
        {
            source = "NutritionApp", result.ConnectionState, result.Availability, result.Freshness, result.Warning,
            requestedDays = days, result.CompleteCoverage, summary?.From, summary?.To, summary?.RetrievedAt, summary?.TimeZone,
            energyUnit = "kcal", summary?.GoalContext, summary?.Period,
            historicalContext = result.HistoricalContext == null ? null : new {
                result.HistoricalContext.RetrievedAt, result.HistoricalContext.TimeZone, result.HistoricalContext.EffectiveGoal,
                scale = AiToolUnits.Weight(result.HistoricalContext.ScaleWeightKg, context.WeightUnit), result.HistoricalContext.ScaleWeightDate,
                trend = AiToolUnits.Weight(result.HistoricalContext.TrendWeightKg, context.WeightUnit), result.HistoricalContext.TrendWeightDate,
                limitation = "Legacy workout-start snapshot only; no intake, maintenance, cleaned-trend verification or complete coverage." },
            weightUnit = context.WeightUnit,
            weight = summary == null ? null : new { summary.Weight.WeighIns, summary.Weight.FirstDate, summary.Weight.LastDate, summary.Weight.FirstTrendDate, summary.Weight.LastTrendDate,
                firstScale = AiToolUnits.Weight(summary.Weight.FirstScaleKg, context.WeightUnit),
                lastScale = AiToolUnits.Weight(summary.Weight.LastScaleKg, context.WeightUnit),
                firstTrend = AiToolUnits.Weight(summary.Weight.FirstTrendKg, context.WeightUnit),
                lastTrend = AiToolUnits.Weight(summary.Weight.LastTrendKg, context.WeightUnit), summary.Weight.TrendMethod },
            summary?.CoachingEligible, summary?.CoachingExplanation,
            recentDays = summary?.Days.Take(7).ToArray(),
            note = "Averages use complete/fasting days only; estimated deficit uses qualified maintenance. Missing protein is unknown. Positive below-target values mean intake was below that target; negative means above."
        }, approximate: summary?.Period.MaintenanceComparedDays > 0 || result.Freshness == "stale");
    }
}
