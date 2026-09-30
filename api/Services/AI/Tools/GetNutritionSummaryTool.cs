using System.Text.Json.Nodes;
using Workout.Api.Services;

namespace Workout.Api.Services.AI.Tools;

public sealed class GetNutritionSummaryTool : IAiTool
{
    private readonly NutritionContextService _nutritionService;

    public GetNutritionSummaryTool(NutritionContextService nutritionService)
    {
        _nutritionService = nutritionService;
    }

    public string Name => "get_nutrition_summary";
    public string Description => "Get the user's linked nutrition summary (goal, weight trend, calorie deficit/surplus mode) if NutritionApp is connected.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject()
    };

    public string ProgressLabel(AiToolArgs args) => "Checking linked nutrition status...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var result = await _nutritionService.Get(cancellationToken);
        if (result.Context == null)
        {
            return AiToolResult.Of(new
            {
                connected = false,
                message = "NutritionApp is not connected or no nutrition context is currently available."
            });
        }

        var ctx = result.Context;
        return AiToolResult.Of(new
        {
            connected = true,
            progressionMode = result.Mode,
            goal = ctx.EffectiveGoal,
            phaseComplete = ctx.PhaseComplete,
            targetRatePercent = ctx.TargetRatePercent,
            observedLossRatePercent = ctx.ObservedLossRatePercent,
            observedWindowDays = ctx.ObservedWindowDays,
            scaleWeight = ConvertWeight(ctx.ScaleWeightKg, context.WeightUnit),
            trendWeight = ConvertWeight(ctx.TrendWeightKg, context.WeightUnit),
            weightUnit = context.WeightUnit,
            cached = result.Cached,
            confirmed = result.Confirmed,
            retrievedAt = ctx.RetrievedAt.ToString("yyyy-MM-dd HH:mm UTC")
        });
    }

    private static double? ConvertWeight(double? weightKg, string unit)
    {
        if (!weightKg.HasValue) return null;
        if (unit.Equals("lb", StringComparison.OrdinalIgnoreCase))
            return Math.Round(weightKg.Value * 2.20462, 1);
        return Math.Round(weightKg.Value, 1);
    }
}
