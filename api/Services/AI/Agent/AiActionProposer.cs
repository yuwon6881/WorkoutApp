using System.Text.Json;
using System.Text.Json.Nodes;
using Workout.Api.Services.AI.Tools;

namespace Workout.Api.Services.AI.Agent;

public sealed class AiActionProposer(AiToolContext toolContext) : IAiActionProposer
{
    private static readonly string[] AllowedTypes = ["openWorkout", "openExercise", "openProgram", "openHistory", "openActiveWorkout", "openAddWorkoutDraft"];
    private readonly AiToolContext _toolContext = toolContext;
    private readonly List<AiUiAction> _accepted = [];
    public IReadOnlyList<AiUiAction> Accepted => _accepted;

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["actions"] = new JsonObject
            {
                ["type"] = "array", ["maxItems"] = 1,
                ["description"] = "One user-requested action to review. Never saves data.",
                ["items"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["type"] = new JsonObject { ["type"] = "string",
                            ["enum"] = new JsonArray(AllowedTypes.Select(t => (JsonNode?)JsonValue.Create(t)).ToArray()) },
                        ["payload"] = new JsonObject { ["type"] = "object", ["description"] = "workoutId for openWorkout, slug or exerciseId for openExercise, optional programId for openProgram, templateId for openAddWorkoutDraft (opens the Workouts screen; does not start a session or select a template). Other fields are ignored." }
                    },
                    ["required"] = new JsonArray("type", "payload")
                }
            }
        },
        ["required"] = new JsonArray("actions")
    };

    public Task<string> ProposeAsync(string argumentsJson, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        JsonDocument document;
        try { document = JsonDocument.Parse(argumentsJson); }
        catch (JsonException) { return Task.FromResult(Error("Invalid arguments JSON.")); }
        using var lifetime = document;
        if (document.RootElement.ValueKind != JsonValueKind.Object ||
            !document.RootElement.TryGetProperty("actions", out var actions) || actions.ValueKind != JsonValueKind.Array)
            return Task.FromResult(Error("actions must be an array."));
        if (actions.GetArrayLength() > 1 || _accepted.Count > 0)
            return Task.FromResult(Error("Only one action can be reviewed per turn."));
        var results = new JsonArray();
        foreach (var action in actions.EnumerateArray())
        {
            try
            {
                if (action.ValueKind != JsonValueKind.Object ||
                    !action.TryGetProperty("type", out var typeValue) || typeValue.ValueKind != JsonValueKind.String ||
                    !action.TryGetProperty("payload", out var payloadValue) || payloadValue.ValueKind != JsonValueKind.Object)
                    throw new AiToolArgumentException("Each action requires a string type and an object payload.");
                var type = AllowedTypes.FirstOrDefault(t => t.Equals(typeValue.GetString(), StringComparison.OrdinalIgnoreCase))
                    ?? throw new AiToolArgumentException("Unsupported action type.");
                var args = AiToolArgs.Parse(payloadValue.GetRawText());
                var payload = new Dictionary<string, object?>();
                switch (type)
                {
                    case "openWorkout":
                        AddEvidence(args, payload, "workoutId", AiEvidenceLedger.Workout, required: true);
                        break;
                    case "openExercise":
                        var slug = args.OptionalString("slug", 160);
                        AddEvidence(args, payload, slug != null ? "slug" : "exerciseId", AiEvidenceLedger.Exercise, required: true);
                        if (slug != null) AddEvidence(args, payload, "exerciseId", AiEvidenceLedger.Exercise);
                        break;
                    case "openProgram":
                        AddEvidence(args, payload, "programId", AiEvidenceLedger.Program);
                        break;
                    case "openAddWorkoutDraft":
                        AddEvidence(args, payload, "templateId", AiEvidenceLedger.Template, required: true);
                        break;
                }
                _accepted.Add(new AiUiAction(type, payload, Guid.NewGuid()));
                results.Add(new JsonObject { ["type"] = type, ["accepted"] = true });
            }
            catch (AiToolArgumentException ex)
            {
                results.Add(new JsonObject { ["accepted"] = false, ["reason"] = ex.Message });
            }
        }
        return Task.FromResult(new JsonObject { ["results"] = results }.ToJsonString());
    }

    private void AddEvidence(AiToolArgs args, Dictionary<string, object?> payload, string key, string kind, bool required = false)
    {
        var id = required ? args.RequiredString(key, 160) : args.OptionalString(key, 160);
        if (id == null) return;
        if (!_toolContext.Evidence.Contains(kind, id))
            throw new AiToolArgumentException($"{key} '{id}' was not returned by any tool this turn. Look it up first.");
        payload[key] = id;
    }

    private static string Error(string message) => new JsonObject { ["ok"] = false, ["error"] = message }.ToJsonString();
}
