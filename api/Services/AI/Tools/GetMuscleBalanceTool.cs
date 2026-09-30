using System.Text.Json.Nodes;
using Workout.Api.Services;

namespace Workout.Api.Services.AI.Tools;

public sealed class GetMuscleBalanceTool : IAiTool
{
    private readonly MuscleBalanceService _muscleBalanceService;

    public GetMuscleBalanceTool(MuscleBalanceService muscleBalanceService)
    {
        _muscleBalanceService = muscleBalanceService;
    }

    public string Name => "get_muscle_balance";
    public string Description => "Get muscle balance and training volume distribution across muscle groups over a time window (1w, 1m, or 3m).";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["range"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "Time window: '1w' (last 7 days), '1m' (last 30 days), or '3m' (last 90 days). Default is '1m'."
            },
            ["timeZone"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "User's local time zone ID (e.g. 'UTC', 'America/New_York', 'Europe/London'). Default is 'UTC'."
            }
        }
    };

    public string ProgressLabel(AiToolArgs args) => "Analyzing muscle training balance...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var range = args.OptionalEnum("range", ["1w", "1m", "3m"]) ?? "1m";
        var timeZone = args.OptionalString("timeZone", 80) ?? context.Zone.Id;

        MuscleBalanceView view;
        try
        {
            view = await _muscleBalanceService.Balance(range, timeZone, cancellationToken);
        }
        catch (Workout.Api.Domain.DomainException ex) when (ex.Status == 400)
        {
            // If the user-supplied time zone fails, fall back to UTC
            view = await _muscleBalanceService.Balance(range, "UTC", cancellationToken);
        }

        var muscles = view.Muscles.Select(m => new
        {
            muscle = m.Muscle,
            totalSets = Math.Round(m.Sets, 1),
            primarySets = Math.Round(m.PrimarySets, 1),
            secondarySets = Math.Round(m.SecondarySets, 1),
            sessions = m.Sessions,
            lastTrainedDate = m.LastTrainedDate?.ToString("yyyy-MM-dd")
        }).ToList();

        return AiToolResult.Of(new
        {
            range = view.Range,
            fromDate = view.From.ToString("yyyy-MM-dd"),
            toDate = view.To.ToString("yyyy-MM-dd"),
            weeks = Math.Round(view.Weeks, 1),
            totalSessions = view.Sessions,
            totalSets = Math.Round(view.TotalSets, 1),
            unattributedSets = Math.Round(view.UnattributedSets, 1),
            muscles
        });
    }
}
