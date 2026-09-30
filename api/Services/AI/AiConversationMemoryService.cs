using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services.AI;

public sealed partial class AiConversationMemoryService
{
    internal const int MaxPromptHistoryCharacters = 12_000;
    private const int MaxHydratedTurns = 100;
    private static readonly TimeSpan AbandonedPendingTurnAge = TimeSpan.FromMinutes(10);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly Regex KeywordPattern = new(@"[\p{L}\p{N}]{3,}", RegexOptions.Compiled);
    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "about", "after", "again", "also", "been", "before", "could", "from", "have", "into",
        "just", "last", "much", "please", "show", "that", "the", "their", "then", "there", "these",
        "this", "those", "what", "when", "where", "which", "with", "would", "your"
    };

    private readonly AppDb _db;

    public AiConversationMemoryService(AppDb db)
    {
        _db = db;
    }

    internal sealed record PreparedConversation(
        AiConversation? Conversation,
        string ClientTurnId,
        IReadOnlyList<AiChatMessage> History,
        AiConversationState? State,
        bool Conflict = false,
        AiChatResponse? Replay = null,
        AiConversationTurn? PendingTurn = null);

    public async Task<AiConversationResponse> GetActiveAsync(CancellationToken cancellationToken = default)
    {
        var conversation = await _db.AiConversations
            .AsNoTracking()
            .SingleOrDefaultAsync(cancellationToken);
        if (conversation == null)
        {
            return new AiConversationResponse(null, 0, [], null);
        }

        var turns = await _db.AiConversationTurns
            .AsNoTracking()
            .Where(turn => turn.ConversationId == conversation.Id && turn.Status == "Completed")
            .OrderByDescending(turn => turn.CreatedAt)
            .ThenByDescending(turn => turn.Id)
            .Take(MaxHydratedTurns)
            .OrderBy(turn => turn.CreatedAt)
            .ThenBy(turn => turn.Id)
            .ToListAsync(cancellationToken);

        var messages = turns
            .SelectMany(turn => new[]
            {
                new AiChatMessage("user", turn.UserMessage),
                new AiChatMessage("assistant", turn.AssistantReply)
            })
            .ToList();

        var pendingBatches = await LoadPendingActionBatchesAsync(conversation.Id, cancellationToken);
        return new AiConversationResponse(
            conversation.Id,
            conversation.Version,
            messages,
            DeserializeState(conversation.StateJson),
            HistoryRedacted: false,
            pendingBatches);
    }

    public async Task<bool> DeleteActiveAsync(
        Guid? conversationId = null,
        int? expectedVersion = null,
        CancellationToken cancellationToken = default)
    {
        var conversation = await _db.AiConversations.SingleOrDefaultAsync(cancellationToken);
        if (conversation == null) return true;
        if (conversationId != null && conversation.Id != conversationId) return false;
        if (expectedVersion != null && conversation.Version != expectedVersion) return false;
        _db.AiConversations.Remove(conversation);
        try { await _db.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateConcurrencyException) { _db.ChangeTracker.Clear(); return false; }
        return true;
    }

    internal async Task<PreparedConversation> PrepareAsync(
        AiChatRequest request,
        CancellationToken cancellationToken)
    {
        var clientTurnId = NormalizeClientTurnId(request.ClientTurnId);
        if (clientTurnId == null)
        {
            return new PreparedConversation(null, string.Empty, [], null, Conflict: true);
        }

        var conversation = await _db.AiConversations.SingleOrDefaultAsync(cancellationToken);
        if (conversation == null)
        {
            if (request.ConversationId != null)
            {
                return new PreparedConversation(null, clientTurnId, [], null, Conflict: true);
            }

            conversation = new AiConversation
            {
                UserId = _db.CurrentUser ?? throw new InvalidOperationException("No current user.")
            };
            _db.AiConversations.Add(conversation);
            try
            {
                await _db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException)
            {
                _db.ChangeTracker.Clear();
                conversation = await _db.AiConversations.SingleAsync(cancellationToken);
            }
        }

        var duplicate = await _db.AiConversationTurns
            .AsNoTracking()
            .SingleOrDefaultAsync(
                turn => turn.ConversationId == conversation.Id && turn.ClientTurnId == clientTurnId,
                cancellationToken);

        if (duplicate != null && IsAbandonedPending(duplicate))
        {
            var abandoned = await _db.AiConversationTurns.FindAsync([duplicate.Id], cancellationToken);
            if (abandoned != null) _db.AiConversationTurns.Remove(abandoned);
            await _db.SaveChangesAsync(cancellationToken);
            _db.ChangeTracker.Clear();
            conversation = await _db.AiConversations.SingleAsync(cancellationToken);
            duplicate = null;
        }

        if (duplicate != null && duplicate.UserMessage != request.Message.Trim())
            return new PreparedConversation(conversation, clientTurnId, [], null, Conflict: true);

        if (duplicate != null)
        {
            if (!duplicate.Status.Equals("Completed", StringComparison.Ordinal))
            {
                return new PreparedConversation(
                    conversation,
                    clientTurnId,
                    [],
                    DeserializeState(conversation.StateJson),
                    Conflict: true);
            }
            return new PreparedConversation(
                conversation,
                clientTurnId,
                [],
                DeserializeState(conversation.StateJson),
                Replay: ToReplay(conversation, duplicate));
        }

        if (request.ConversationId != null && request.ConversationId != conversation.Id)
        {
            return new PreparedConversation(
                conversation, clientTurnId, [], DeserializeState(conversation.StateJson), Conflict: true);
        }
        if (request.ConversationId != null &&
            request.ConversationVersion != null &&
            request.ConversationVersion != conversation.Version)
        {
            return new PreparedConversation(
                conversation, clientTurnId, [], DeserializeState(conversation.StateJson), Conflict: true);
        }

        var history = await SelectPromptHistoryAsync(conversation.Id, request.Message, cancellationToken);
        var pendingTurn = new AiConversationTurn
        {
            UserId = _db.CurrentUser ?? throw new InvalidOperationException("No current user."),
            ConversationId = conversation.Id,
            ClientTurnId = clientTurnId,
            UserMessage = request.Message.Trim(),
            AssistantReply = string.Empty,
            ActionsJson = "[]",
            Status = "Pending",
            ConversationVersion = conversation.Version,
            CreatedAt = DateTime.UtcNow
        };
        _db.AiConversationTurns.Add(pendingTurn);

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            _db.ChangeTracker.Clear();
            conversation = await _db.AiConversations.SingleAsync(cancellationToken);
            var winner = await _db.AiConversationTurns
                .AsNoTracking()
                .SingleAsync(
                    turn => turn.ConversationId == conversation.Id && turn.ClientTurnId == clientTurnId,
                    cancellationToken);
            return new PreparedConversation(
                conversation,
                clientTurnId,
                [],
                DeserializeState(conversation.StateJson),
                Conflict: winner.Status != "Completed",
                Replay: winner.Status == "Completed" ? ToReplay(conversation, winner) : null);
        }

        return new PreparedConversation(
            conversation,
            clientTurnId,
            history,
            DeserializeState(conversation.StateJson),
            PendingTurn: pendingTurn);
    }

    internal async Task<AiChatResponse?> CompleteAsync(
        PreparedConversation prepared,
        string message,
        AiChatResponse response,
        CancellationToken cancellationToken,
        IReadOnlyList<Agent.AiToolTrace>? toolTrace = null)
    {
        var conversation = prepared.Conversation!;
        var nextVersion = checked(conversation.Version + 1);
        var state = response.State;
        conversation.StateJson = state == null ? null : JsonSerializer.Serialize(state, JsonOptions);
        conversation.Version = nextVersion;
        conversation.UpdatedAt = DateTime.UtcNow;

        var metadata = BuildMetadata(message);
        var actions = response.Actions
            .Select(action => action.ActionId == null ? action with { ActionId = Guid.NewGuid() } : action)
            .ToList();
        var turn = prepared.PendingTurn ?? throw new InvalidOperationException("The AI turn was not reserved.");
        turn.UserMessage = message.Trim();
        turn.AssistantReply = response.Reply;
        turn.ActionsJson = JsonSerializer.Serialize(actions, JsonOptions);
        turn.CloseChat = response.CloseChat;
        turn.Intent = metadata.Intent;
        turn.Topic = metadata.Topic;
        turn.FacetsJson = JsonSerializer.Serialize(metadata.Facets, JsonOptions);
        turn.KeywordsJson = JsonSerializer.Serialize(metadata.Keywords, JsonOptions);
        turn.ToolTraceJson = toolTrace is not { Count: > 0 }
            ? null
            : JsonSerializer.Serialize(
                toolTrace.Take(8).Select(entry =>
                    $"{entry.Tool} {(entry.Arguments.Length <= 160 ? entry.Arguments : entry.Arguments[..160] + "…")}"),
                JsonOptions);
        turn.ConversationVersion = nextVersion;
        turn.Status = "Completed";
        turn.CompletedAt = DateTime.UtcNow;
        if (actions.Count == 0) turn.ActionsResolvedAt = DateTime.UtcNow;

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            return null;
        }

        var actionBatch = actions.Count > 0 ? new AiActionBatchResponse(turn.Id, actions) : null;
        return response with
        {
            Actions = actions,
            State = state,
            ConversationId = conversation.Id,
            ConversationVersion = nextVersion,
            ActionBatch = actionBatch
        };
    }

    internal async Task FailAsync(PreparedConversation prepared, CancellationToken cancellationToken)
    {
        if (prepared.PendingTurn == null) return;
        _db.ChangeTracker.Clear();
        var pending = await _db.AiConversationTurns
            .SingleOrDefaultAsync(turn => turn.Id == prepared.PendingTurn.Id && turn.Status == "Pending", cancellationToken);
        if (pending == null) return;
        _db.AiConversationTurns.Remove(pending);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ResolveActionBatchAsync(
        Guid batchId,
        bool dismissed,
        CancellationToken cancellationToken)
    {
        var turn = await _db.AiConversationTurns
            .SingleOrDefaultAsync(candidate => candidate.Id == batchId && candidate.Status == "Completed", cancellationToken);
        if (turn == null) return false;
        if (turn.ActionsResolvedAt != null) return true;
        turn.ActionsResolvedAt = DateTime.UtcNow;
        turn.ActionsDismissedAt = dismissed ? DateTime.UtcNow : null;
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }

    private async Task<IReadOnlyList<AiChatMessage>> SelectPromptHistoryAsync(
        Guid conversationId,
        string currentMessage,
        CancellationToken cancellationToken)
    {
        var turns = await _db.AiConversationTurns
            .AsNoTracking()
            .Where(turn => turn.ConversationId == conversationId && turn.Status == "Completed")
            .OrderByDescending(turn => turn.CreatedAt)
            .ThenByDescending(turn => turn.Id)
            .Take(100)
            .ToListAsync(cancellationToken);

        var latest = turns.Take(3).ToList();
        var current = BuildMetadata(currentMessage);
        var older = turns.Skip(3)
            .Select(turn => new { Turn = turn, Score = Score(turn, current) })
            .OrderByDescending(candidate => candidate.Score)
            .ThenByDescending(candidate => candidate.Turn.CreatedAt)
            .Take(3)
            .Select(candidate => candidate.Turn);

        var selected = latest.Concat(older)
            .DistinctBy(turn => turn.Id)
            .OrderBy(turn => turn.CreatedAt)
            .ThenBy(turn => turn.Id)
            .ToList();

        var messages = new List<AiChatMessage>();
        var characters = 0;
        foreach (var turn in selected.AsEnumerable().Reverse())
        {
            var assistant = turn.AssistantReply + DescribeLookups(turn.ToolTraceJson);
            var turnCharacters = turn.UserMessage.Length + assistant.Length;
            if (characters + turnCharacters > MaxPromptHistoryCharacters) continue;
            characters += turnCharacters;
            messages.Add(new AiChatMessage("assistant", assistant));
            messages.Add(new AiChatMessage("user", turn.UserMessage));
        }
        messages.Reverse();
        return messages;
    }

    private static string DescribeLookups(string? toolTraceJson)
    {
        if (string.IsNullOrWhiteSpace(toolTraceJson)) return string.Empty;
        try
        {
            var lookups = JsonSerializer.Deserialize<List<string>>(toolTraceJson, JsonOptions);
            return lookups is { Count: > 0 } ? $"\n[Looked up: {string.Join("; ", lookups)}]" : string.Empty;
        }
        catch (JsonException)
        {
            return string.Empty;
        }
    }

    private async Task<IReadOnlyList<AiActionBatchResponse>> LoadPendingActionBatchesAsync(
        Guid conversationId,
        CancellationToken cancellationToken)
    {
        var turns = await _db.AiConversationTurns
            .AsNoTracking()
            .Where(turn => turn.ConversationId == conversationId &&
                           turn.Status == "Completed" &&
                           turn.ActionsResolvedAt == null &&
                           turn.ActionsJson != "[]")
            .OrderBy(turn => turn.CreatedAt)
            .Take(20)
            .ToListAsync(cancellationToken);

        return turns
            .Select(turn => new AiActionBatchResponse(turn.Id, DeserializeActions(turn.ActionsJson)))
            .Where(batch => batch.Actions.Count > 0)
            .ToList();
    }

    private static AiChatResponse ToReplay(AiConversation conversation, AiConversationTurn turn)
    {
        var actions = turn.ActionsResolvedAt == null ? DeserializeActions(turn.ActionsJson) : [];
        var batch = actions.Count > 0 ? new AiActionBatchResponse(turn.Id, actions) : null;
        return new AiChatResponse(
            turn.AssistantReply,
            actions,
            turn.CloseChat,
            DeserializeState(conversation.StateJson),
            conversation.Id,
            conversation.Version,
            HistoryRedacted: false,
            batch);
    }

    private static IReadOnlyList<AiUiAction> DeserializeActions(string json)
    {
        try { return JsonSerializer.Deserialize<List<AiUiAction>>(json, JsonOptions) ?? []; }
        catch (JsonException) { return []; }
    }

    private static AiConversationState? DeserializeState(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<AiConversationState>(json, JsonOptions); }
        catch (JsonException) { return null; }
    }

    private static bool IsAbandonedPending(AiConversationTurn turn) =>
        !turn.Status.Equals("Completed", StringComparison.Ordinal) &&
        turn.CreatedAt < DateTime.UtcNow - AbandonedPendingTurnAge;

    private static string? NormalizeClientTurnId(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var normalized = value.Trim();
        return normalized.Length <= 64 ? normalized : null;
    }

    private sealed record TurnMetadata(string? Intent, string? Topic, IReadOnlyList<string> Facets, IReadOnlyList<string> Keywords);

    private static TurnMetadata BuildMetadata(string message)
    {
        var keywords = KeywordPattern.Matches(message.ToLowerInvariant())
            .Select(match => match.Value)
            .Where(word => !StopWords.Contains(word))
            .Distinct(StringComparer.Ordinal)
            .Take(20)
            .ToList();
        var topic = Regex.IsMatch(message, @"\b(workout|session|training|lift|routine)\b", RegexOptions.IgnoreCase)
            ? "workout"
            : Regex.IsMatch(message, @"\b(program|phase|block|week|schedule)\b", RegexOptions.IgnoreCase)
                ? "program"
                : Regex.IsMatch(message, @"\b(progress|e1rm|pr|record|max|trend)\b", RegexOptions.IgnoreCase)
                    ? "progress"
                    : Regex.IsMatch(message, @"\b(exercise|muscle|balance|form|cue)\b", RegexOptions.IgnoreCase)
                        ? "exercise"
                        : null;
        return new TurnMetadata(null, topic, [], keywords);
    }

    private static int Score(AiConversationTurn turn, TurnMetadata current)
    {
        var score = 0;
        if (current.Topic != null && string.Equals(turn.Topic, current.Topic, StringComparison.Ordinal)) score += 30;
        var keywords = DeserializeStringSet(turn.KeywordsJson);
        score += current.Keywords.Count(keywords.Contains) * 5;
        return score;
    }

    private static HashSet<string> DeserializeStringSet(string? json)
    {
        try { return JsonSerializer.Deserialize<List<string>>(json ?? "[]", JsonOptions)?.ToHashSet(StringComparer.OrdinalIgnoreCase) ?? []; }
        catch (JsonException) { return []; }
    }
}
