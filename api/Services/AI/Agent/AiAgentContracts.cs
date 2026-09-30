using System.Text.Json.Nodes;
using Workout.Api.Services.AI.Tools;

namespace Workout.Api.Services.AI.Agent;

// Live progress for one turn. Status labels and text deltas are provisional: the final reply is
// authoritative and may differ, so a client always replaces streamed text with the completed answer.
public interface IAiAgentProgressSink
{
    ValueTask OnStatusAsync(string label, CancellationToken cancellationToken);
    ValueTask OnTextDeltaAsync(string delta, CancellationToken cancellationToken);
    ValueTask OnTextResetAsync(CancellationToken cancellationToken);
}

// Validates the UI actions the model proposes. Implemented by the assistant service, which owns the
// action rules; the engine only relays the verdict back to the model.
public interface IAiActionProposer
{
    JsonObject ParametersSchema { get; }
    Task<string> ProposeAsync(string argumentsJson, CancellationToken cancellationToken);
    IReadOnlyList<AiUiAction> Accepted { get; }
}

public sealed record AiSeededToolCall(string ToolName, string ArgumentsJson);

public sealed record AiAgentTurnRequest(
    string UserMessage,
    IReadOnlyList<JsonObject> PriorInput,
    AiToolContext ToolContext,
    IAiActionProposer ActionProposer,
    IReadOnlyList<AiSeededToolCall>? SeededCalls = null,
    string? ForcedFirstTool = null,
    IAiAgentProgressSink? Sink = null);

public sealed record AiToolTrace(string Tool, string Arguments, bool Succeeded);

public sealed record AiAgentTurnResult(
    string Reply,
    IReadOnlyList<AiUiAction> Actions,
    IReadOnlyList<AiToolTrace> Trace,
    AiTokenUsage Usage,
    int Rounds,
    bool AnyApproximate,
    bool HitToolLimit);
