using System.ComponentModel.DataAnnotations;

namespace Workout.Api.Data;

// One active conversation per user. The version counter enables optimistic concurrency so a
// request that was started before a concurrent turn completed can be detected at commit time.
public sealed class AiConversation
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }

    public int Version { get; set; }

    public string? StateJson { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<AiConversationTurn> Turns { get; set; } = [];
}

public sealed class AiConversationTurn
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }

    public Guid ConversationId { get; set; }

    public AiConversation Conversation { get; set; } = null!;

    [StringLength(64)]
    public string ClientTurnId { get; set; } = string.Empty;

    [StringLength(2000)]
    public string UserMessage { get; set; } = string.Empty;

    public string AssistantReply { get; set; } = string.Empty;

    public string ActionsJson { get; set; } = "[]";

    [StringLength(16)]
    public string Status { get; set; } = "Completed";

    public DateTime? ActionsResolvedAt { get; set; }

    public DateTime? ActionsDismissedAt { get; set; }

    public bool CloseChat { get; set; }

    [StringLength(80)]
    public string? Intent { get; set; }

    [StringLength(32)]
    public string? Topic { get; set; }

    public string? FacetsJson { get; set; }

    public string? KeywordsJson { get; set; }

    // The lookups the assistant made for this turn (tool names and arguments, never results), so a
    // follow-up such as "and before that?" knows what was already searched.
    public string? ToolTraceJson { get; set; }

    public int ConversationVersion { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? CompletedAt { get; set; }
}
