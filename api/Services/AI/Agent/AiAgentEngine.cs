using System.Diagnostics;
using System.Text.Json.Nodes;
using Workout.Api.Services.AI.Tools;

namespace Workout.Api.Services.AI.Agent;

// Runs one assistant turn: the model reads, calls read-only tools, proposes UI actions for
// server validation, and answers. The loop is bounded by rounds and by the tool budget.
public sealed class AiAgentEngine
{
    public const int MaxToolRounds = 4;
    private const int MaxOutputTokens = 2400;
    private const string PromptCacheKey = "workout-ask-ai-v1";

    private readonly AiChatClient _client;
    private readonly AiChatUsageMeter _usage;
    private readonly long _dailyTokenLimit;
    private readonly AiToolRegistry _registry;
    private readonly AiToolExecutor _executor;
    private readonly ILogger<AiAgentEngine> _logger;

    public AiAgentEngine(AiChatClient client, AiToolRegistry registry, AiToolExecutor executor, ILogger<AiAgentEngine> logger, AiChatUsageMeter usage, IConfiguration configuration)
    {
        _client = client;
        _usage = usage;
        _dailyTokenLimit = Math.Max(1, configuration.GetValue<long>("Ai:ChatDailyTokenLimit", 100_000));
        _registry = registry;
        _executor = executor;
        _logger = logger;
    }

    public async Task<AiAgentTurnResult> RunAsync(AiAgentTurnRequest request, CancellationToken cancellationToken)
    {
        var startedAt = Stopwatch.GetTimestamp();
        // Read tools appear in fixed order first so the prompt prefix remains cacheable,
        // followed by the session-specific action proposal schema.
        var tools = _registry.Definitions
            .Append(new AiFunctionTool(
                AiAgentPrompt.ProposeActionsTool,
                "Propose app actions for the user to review: open a screen, prepare add/edit drafts, or ask the app to " +
                "confirm a change. Returns accepted or rejected with a reason for each action.",
                request.ActionProposer.ParametersSchema))
            .ToList();
        var input = new List<JsonObject>(request.PriorInput) { AiInputItems.Message("user", request.UserMessage) };
        var trace = new List<AiToolTrace>();
        var usage = AiTokenUsage.None;
        var anyApproximate = false;
        var streamSink = request.Sink == null ? null : new StreamRelay(request.Sink);

        if (request.SeededCalls is { Count: > 0 } seeded)
        {
            foreach (var (call, index) in seeded.Select((call, index) => (call, index)))
            {
                var functionCall = new AiFunctionCall($"seed_{index}", call.ToolName, call.ArgumentsJson);
                var execution = await ExecuteAsync(functionCall, request, cancellationToken);
                anyApproximate |= execution.Approximate || execution.Truncated;
                trace.Add(new AiToolTrace(call.ToolName, call.ArgumentsJson, execution.Succeeded));
                input.Add(AiInputItems.FunctionCall(functionCall.CallId, call.ToolName, call.ArgumentsJson));
                input.Add(AiInputItems.FunctionCallOutput(functionCall.CallId, execution.Output));
            }
        }

        for (var round = 1; ; round++)
        {
            if (!await _usage.HasBudgetAsync(_dailyTokenLimit, cancellationToken))
                throw new AiChatClientException("Your daily AI chat allowance has been reached. Please try again tomorrow.");
            var atLimit = round > MaxToolRounds || request.ToolContext.Budget.RemainingToolCalls <= 0;
            if (atLimit) input.Add(AiInputItems.Message("developer", AiAgentPrompt.ToolLimitNote));
            var toolChoice = atLimit ? "none" : round == 1 && request.ForcedFirstTool != null ? request.ForcedFirstTool : "auto";

            var result = await _client.CreateResponseAsync(
                new AiResponseRequest(
                    "chat-agent",
                    input,
                    MaxOutputTokens,
                    "OpenAi:Models:Chat",
                    Instructions: AiAgentPrompt.Instructions,
                    Tools: tools,
                    ToolChoice: toolChoice,
                    ReasoningEffort: "low",
                    PromptCacheKey: PromptCacheKey),
                streamSink,
                cancellationToken);
            // Account for each successful provider response, including rounds before a later failure.
            using (var accountingDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
                await _usage.RecordAsync(result.Usage, 1, accountingDeadline.Token);
            usage = Add(usage, result.Usage);
            input.AddRange(result.OutputItems);

            if (result.FunctionCalls.Count == 0 || atLimit)
            {
                var reply = result.Text.Length > 0
                    ? result.Text
                    : "I couldn't finish looking that up. Please try asking again.";
                _logger.LogInformation(
                    "Ask AI turn finished in {ElapsedMs:F0} ms, {Rounds} round(s), {ToolCalls} tool call(s); in={Input}, cached={Cached}, out={Output}, reasoning={Reasoning}.",
                    Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds, round, trace.Count, usage.InputTokens, usage.CachedTokens, usage.OutputTokens, usage.ReasoningTokens);
                return new AiAgentTurnResult(
                    reply, request.ActionProposer.Accepted, trace, usage, round, anyApproximate, atLimit);
            }

            // Discard any intermediate text generated prior to tool invocations so user only sees final response.
            if (request.Sink != null && result.Text.Length > 0) await request.Sink.OnTextResetAsync(cancellationToken);
            foreach (var call in result.FunctionCalls)
            {
                string output;
                bool succeeded;
                if (call.Name == AiAgentPrompt.ProposeActionsTool)
                {
                    if (request.Sink != null) await request.Sink.OnStatusAsync("Preparing that for you", cancellationToken);
                    output = await request.ActionProposer.ProposeAsync(call.ArgumentsJson, cancellationToken);
                    succeeded = true;
                }
                else
                {
                    var execution = await ExecuteAsync(call, request, cancellationToken);
                    output = execution.Output;
                    succeeded = execution.Succeeded;
                    anyApproximate |= execution.Approximate || execution.Truncated;
                }
                trace.Add(new AiToolTrace(call.Name, call.ArgumentsJson, succeeded));
                input.Add(AiInputItems.FunctionCallOutput(call.CallId, output));
            }
        }
    }

    private async Task<AiToolExecution> ExecuteAsync(AiFunctionCall call, AiAgentTurnRequest request, CancellationToken cancellationToken)
    {
        if (request.Sink != null)
        {
            var label = _registry.Find(call.Name) is { } tool ? SafeLabel(tool, call.ArgumentsJson) : "Checking your data";
            await request.Sink.OnStatusAsync(label, cancellationToken);
        }
        return await _executor.ExecuteAsync(call, request.ToolContext, cancellationToken);
    }

    // Protect progress notification against invalid arguments by falling back to empty parameters safely.
    private static string SafeLabel(IAiTool tool, string arguments)
    {
        try { return tool.ProgressLabel(AiToolArgs.Parse(arguments)); }
        catch (AiToolArgumentException) { return tool.ProgressLabel(AiToolArgs.Empty); }
    }

    private static AiTokenUsage Add(AiTokenUsage left, AiTokenUsage right) => new(
        left.InputTokens + right.InputTokens,
        left.CachedTokens + right.CachedTokens,
        left.OutputTokens + right.OutputTokens,
        left.ReasoningTokens + right.ReasoningTokens);

    private sealed class StreamRelay(IAiAgentProgressSink sink) : IAiStreamSink
    {
        public ValueTask OnTextDeltaAsync(string delta, CancellationToken cancellationToken) =>
            sink.OnTextDeltaAsync(delta, cancellationToken);
        public ValueTask OnToolCallStartedAsync(string toolName, CancellationToken cancellationToken) =>
            ValueTask.CompletedTask;
    }
}
