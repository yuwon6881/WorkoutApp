using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Services.AI.Agent;
using Workout.Api.Services.AI.Tools;

namespace Workout.Api.Services.AI;

public sealed class AiAssistantService
{
    private const int MaxMessageLength = 2000;
    private static readonly Regex GreetingPattern = new(@"^\s*(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\s*[\.!\?]*\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ThanksPattern = new(@"^\s*(thanks|thank\s+you|thx)\s*[\.!\?]*\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex WhoAreYouPattern = new(@"^\s*(who\s+are\s+you|what\s+can\s+you\s+do|help)\s*[\.!\?]*\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly TimeProvider _timeProvider;
    private readonly AiChatClient _client;
    private readonly AppDb _db;
    private readonly AiAgentServices _agent;
    private readonly AiConversationMemoryService _conversationMemory;
    private readonly ILogger<AiAssistantService> _logger;

    public AiAssistantService(
        AiChatClient client,
        AppDb db,
        AiAgentServices agent,
        AiConversationMemoryService conversationMemory,
        ILogger<AiAssistantService> logger,
        TimeProvider? timeProvider = null)
    {
        _timeProvider = timeProvider ?? TimeProvider.System;
        _client = client;
        _db = db;
        _agent = agent;
        _conversationMemory = conversationMemory;
        _logger = logger;
    }

    public Task<AiChatOutcome> ChatAsync(AiChatRequest request, CancellationToken cancellationToken = default) =>
        ChatAsync(request, sink: null, cancellationToken);

    public async Task<AiChatOutcome> ChatAsync(
        AiChatRequest request,
        IAiAgentProgressSink? sink,
        CancellationToken cancellationToken = default)
    {
        var message = (request.Message ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(message))
            return Ok(new AiChatResponse("Please ask a question about your workouts, exercises, or training program.", []));
        if (message.Length > MaxMessageLength)
            return Ok(new AiChatResponse("That message is too long. Please shorten it and try again.", []));

        if (string.IsNullOrWhiteSpace(request.ClientTurnId))
            return new AiChatOutcome(new AiChatResponse("A client turn ID is required. Reload the conversation and retry.", []), false, IsConflict: true);

        var prepared = await _conversationMemory.PrepareAsync(request, cancellationToken);
        if (prepared.Replay != null) return Ok(prepared.Replay);
        if (prepared.Conflict || prepared.Conversation == null)
        {
            return new AiChatOutcome(
                new AiChatResponse(
                    "This conversation changed on another device. Reload it and retry your message.",
                    [],
                    ConversationId: prepared.Conversation?.Id,
                    ConversationVersion: prepared.Conversation?.Version),
                IsProviderError: false,
                IsConflict: true);
        }

        var serverRequest = request with
        {
            History = prepared.History,
            State = prepared.State
        };

        using var deadlineTimer = new CancellationTokenSource(TimeSpan.FromSeconds(150), _timeProvider);
        using var turnDeadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadlineTimer.Token);
        AiChatOutcome outcome;
        try
        {
            outcome = await ExecuteTurnAsync(serverRequest, sink, turnDeadline.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && turnDeadline.IsCancellationRequested)
        {
            await _conversationMemory.FailAsync(prepared, CancellationToken.None);
            return new AiChatOutcome(new AiChatResponse("AI took too long to finish. Your conversation is retained; retry your message.", [],
                ConversationId: prepared.Conversation.Id, ConversationVersion: prepared.Conversation.Version), IsProviderError: true);
        }
        catch
        {
            await _conversationMemory.FailAsync(prepared, CancellationToken.None);
            throw;
        }

        if (outcome.IsProviderError)
        {
            await _conversationMemory.FailAsync(prepared, cancellationToken);
            return outcome with
            {
                Response = outcome.Response with
                {
                    ConversationId = prepared.Conversation.Id,
                    ConversationVersion = prepared.Conversation.Version
                }
            };
        }

        var completed = await _conversationMemory.CompleteAsync(
            prepared,
            request.Message ?? string.Empty,
            outcome.Response,
            cancellationToken,
            outcome.ToolTrace);

        if (completed == null)
        {
            await _conversationMemory.FailAsync(prepared, cancellationToken);
            return new AiChatOutcome(
                new AiChatResponse(
                    "This conversation changed on another device. Reload it and retry your message.",
                    [],
                    ConversationId: prepared.Conversation.Id,
                    ConversationVersion: prepared.Conversation.Version),
                IsProviderError: false,
                IsConflict: true);
        }

        return outcome with { Response = completed };
    }

    private async Task<AiChatOutcome> ExecuteTurnAsync(
        AiChatRequest request,
        IAiAgentProgressSink? sink,
        CancellationToken cancellationToken)
    {
        var message = (request.Message ?? string.Empty).Trim();
        if (TryHandleSmallTalk(message, out var smallTalkReply))
            return Ok(new AiChatResponse(smallTalkReply!, []));

        if (!_client.IsConfigured)
            return Ok(new AiChatResponse("AI chat is not configured on the server.", []));

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == _db.CurrentUser, cancellationToken);
        var weightUnit = user?.Unit ?? "kg";
        var zoneId = request.Context?.TimeZone ?? "UTC";
        if (!TimeZoneInfo.TryFindSystemTimeZoneById(zoneId, out var zone)) zone = TimeZoneInfo.Utc;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        var toolContext = new AiToolContext(weightUnit, today, timeZone: zone.Id, trackRir: user?.TrackRir ?? true);

        var proposer = new AiActionProposer(toolContext);
        var snapshot = await _agent.Snapshot.BuildAsync(toolContext, cancellationToken);
        var priorInput = BuildPriorInput(request.History, snapshot, request.Context);
        var seededCalls = BuildSeededCalls(request.Context);

        AiAgentTurnResult turn;
        try
        {
            turn = await _agent.Engine.RunAsync(
                new AiAgentTurnRequest(
                    message,
                    priorInput,
                    toolContext,
                    proposer,
                    seededCalls,
                    Sink: sink),
                cancellationToken);
        }
        catch (AiChatClientException ex)
        {
            return new AiChatOutcome(new AiChatResponse(ex.Message, []), IsProviderError: true);
        }


        var reply = turn.AnyApproximate
            ? EnforceApproximateWording(turn.Reply)
            : turn.Reply;

        var actions = turn.Actions;
        var closeChat = actions.Count > 0 && actions.Any(a => a.Type.StartsWith("open", StringComparison.OrdinalIgnoreCase) && a.Type != "openAddWorkoutDraft");

        var outgoingState = new AiConversationState(
            LastWorkoutIds: toolContext.Evidence.IdsOf(AiEvidenceLedger.Workout).Take(10).ToList() is { Count: > 0 } wids ? wids : request.State?.LastWorkoutIds,
            LastExerciseSlugs: toolContext.Evidence.IdsOf(AiEvidenceLedger.Exercise).Take(10).ToList() is { Count: > 0 } eids ? eids : request.State?.LastExerciseSlugs,
            LastProgramId: toolContext.Evidence.IdsOf(AiEvidenceLedger.Program).FirstOrDefault() ?? request.State?.LastProgramId);

        var response = new AiChatResponse(reply, actions, closeChat, outgoingState);
        return new AiChatOutcome(response, IsProviderError: false, ToolTrace: turn.Trace);
    }

    private static List<JsonObject> BuildPriorInput(
        IReadOnlyList<AiChatMessage>? history,
        JsonObject snapshot,
        AiInvocationContext? context)
    {
        var contextNode = new JsonObject
        {
            ["snapshot"] = snapshot
        };
        if (context != null)
        {
            contextNode["openedFrom"] = new JsonObject
            {
                ["surface"] = context.Surface,
                ["preset"] = context.Preset,
                ["exerciseSlug"] = context.ExerciseSlug,
                ["workoutId"] = context.WorkoutId
            };
        }

        var input = new List<JsonObject>();
        if (history != null)
        {
            foreach (var msg in history)
                input.Add(AiInputItems.Message(msg.Role == "assistant" ? "assistant" : "user", msg.Content));
        }

        input.Add(AiInputItems.Message("developer",
            "Current training context (authoritative; past replies may be stale):\n" + contextNode.ToJsonString()));
        return input;
    }

    internal static IReadOnlyList<AiSeededToolCall>? BuildSeededCalls(AiInvocationContext? context)
    {
        if (context == null || string.IsNullOrWhiteSpace(context.Preset)) return null;

        return context.Preset switch
        {
            "exercise-progress" when !string.IsNullOrWhiteSpace(context.ExerciseSlug) =>
                [new("get_exercise_progress", JsonSerializer.Serialize(new { exercise = context.ExerciseSlug }))],
            "workout-detail" when !string.IsNullOrWhiteSpace(context.WorkoutId) =>
                [new("get_workout_detail", JsonSerializer.Serialize(new { workoutId = context.WorkoutId }))],
            "program-overview" =>
                [new("get_program_overview", "{}")],
            _ => null
        };
    }

    private static bool TryHandleSmallTalk(string message, out string? reply)
    {
        reply = null;
        if (GreetingPattern.IsMatch(message))
        {
            reply = "Hello! How can I help with your training today? You can ask about your past workouts, exercise progress, or current program.";
            return true;
        }
        if (ThanksPattern.IsMatch(message))
        {
            reply = "You're welcome! Let me know if you need anything else for your training.";
            return true;
        }
        if (WhoAreYouPattern.IsMatch(message))
        {
            reply = "I'm your WorkoutApp training assistant. I can look up your workout history, analyze exercise progress and personal records, check your current training program, search exercises, and help plan your training.";
            return true;
        }
        return false;
    }

    private static string EnforceApproximateWording(string reply)
    {
        if (reply.Contains("approx", StringComparison.OrdinalIgnoreCase) ||
            reply.Contains("partial", StringComparison.OrdinalIgnoreCase) ||
            reply.Contains("estimate", StringComparison.OrdinalIgnoreCase))
            return reply;
        return reply + "\n\n*(Note: Some data was truncated or approximate.)*";
    }

    private static AiChatOutcome Ok(AiChatResponse response) => new(response, IsProviderError: false);
}
