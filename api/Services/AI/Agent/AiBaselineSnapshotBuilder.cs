using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Services.AI.Tools;

namespace Workout.Api.Services.AI.Agent;

// Baseline facts use the same read tools as later lookups so their semantics cannot drift.
public sealed class AiBaselineSnapshotBuilder(AppDb db)
{
    public async Task<JsonObject> BuildAsync(AiToolContext context, CancellationToken cancellationToken)
    {
        var snapshot = new JsonObject
        {
            ["today"] = context.Today.ToString("yyyy-MM-dd"),
            ["timeZone"] = context.Zone.Id,
            ["weightUnit"] = context.WeightUnit
        };
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == db.CurrentUser, cancellationToken);
        if (user != null) snapshot["displayName"] = user.DisplayName;
        snapshot["trackRir"] = user?.TrackRir ?? true;
        // Only the compact fields below are delivered; omitted template/exercise IDs cannot authorize actions.
        var baselineContext = new AiToolContext(context.WeightUnit, context.Today,
            timeZone: context.Zone.Id, trackRir: context.TrackRir);
        var program = await new GetProgramOverviewTool(db).ExecuteAsync(AiToolArgs.Empty, baselineContext, cancellationToken);
        var programNode = JsonSerializer.SerializeToNode(program.Data);
        if (programNode?["hasActiveProgram"]?.GetValue<bool>() == true)
            snapshot["activeProgram"] = new JsonObject
            {
                ["id"] = programNode["programId"]?.DeepClone(), ["name"] = programNode["programName"]?.DeepClone(),
                ["currentWeek"] = programNode["currentWeek"]?.DeepClone(), ["totalWeeks"] = programNode["totalWeeks"]?.DeepClone(),
                ["runNumber"] = programNode["runNumber"]?.DeepClone(),
                ["runCompleted"] = programNode["runCompleted"]?.DeepClone(),
                ["lifecycleStatus"] = programNode["lifecycleStatus"]?.DeepClone()
            };
        if (programNode?["activeStandalone"] is JsonObject standalone)
            snapshot["activeStandalone"] = new JsonObject { ["name"] = standalone["name"]?.DeepClone(),
                ["completed"] = standalone["completed"]?.DeepClone() };
        var active = await new GetActiveWorkoutTool(db).ExecuteAsync(AiToolArgs.Empty, baselineContext, cancellationToken);
        var activeNode = JsonSerializer.SerializeToNode(active.Data);
        if (activeNode?["hasActiveWorkout"]?.GetValue<bool>() == true)
            snapshot["activeWorkout"] = new JsonObject
            {
                ["id"] = activeNode["workoutId"]?.DeepClone(), ["name"] = activeNode["name"]?.DeepClone(),
                ["startedAt"] = activeNode["startedAt"]?.DeepClone()
            };
        context.Evidence.Record(AiEvidenceLedger.Program, snapshot["activeProgram"]?["id"]?.GetValue<string>());
        context.Evidence.Record(AiEvidenceLedger.Workout, snapshot["activeWorkout"]?["id"]?.GetValue<string>());
        return snapshot;
    }
}
