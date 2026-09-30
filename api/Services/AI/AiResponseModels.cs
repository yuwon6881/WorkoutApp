using System.Text.Json.Nodes;

namespace Workout.Api.Services.AI;

public sealed record AiFunctionTool(string Name, string Description, JsonObject Parameters, bool Strict = false);

public sealed record AiResponseRequest(
    string Feature,
    IReadOnlyList<JsonObject> Input,
    int MaxOutputTokens,
    string ModelConfigurationKey,
    string? Instructions = null,
    IReadOnlyList<AiFunctionTool>? Tools = null,
    string? ToolChoice = null,
    bool ParallelToolCalls = true,
    string? ReasoningEffort = "low",
    object? OutputJsonSchema = null,
    string? PromptCacheKey = null,
    TimeSpan? Timeout = null);

public sealed record AiFunctionCall(string CallId, string Name, string ArgumentsJson);

public sealed record AiTokenUsage(int InputTokens, int CachedTokens, int OutputTokens, int ReasoningTokens)
{
    public static readonly AiTokenUsage None = new(0, 0, 0, 0);
}

public sealed record AiResponseResult(
    string Model,
    string Text,
    IReadOnlyList<AiFunctionCall> FunctionCalls,
    IReadOnlyList<JsonObject> OutputItems,
    AiTokenUsage Usage);

public interface IAiStreamSink
{
    ValueTask OnTextDeltaAsync(string delta, CancellationToken cancellationToken);
    ValueTask OnToolCallStartedAsync(string toolName, CancellationToken cancellationToken);
}

public static class AiInputItems
{
    public static JsonObject Message(string role, string text) => new()
    {
        ["role"] = role,
        ["content"] = text
    };

    public static JsonObject FunctionCall(string callId, string name, string argumentsJson) => new()
    {
        ["type"] = "function_call",
        ["call_id"] = callId,
        ["name"] = name,
        ["arguments"] = argumentsJson
    };

    public static JsonObject FunctionCallOutput(string callId, string output) => new()
    {
        ["type"] = "function_call_output",
        ["call_id"] = callId,
        ["output"] = output
    };
}
