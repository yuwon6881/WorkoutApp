namespace Workout.Api.Data;

public sealed class AiUsage
{
    public Guid UserId { get; set; }
    public DateOnly Date { get; set; }
    /// Import call count (legacy field).
    public int Count { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Ask AI chat token accounting, separate from import usage.
    public long ChatInputTokens { get; set; }
    public long ChatCachedTokens { get; set; }
    public long ChatOutputTokens { get; set; }
    public long ChatReasoningTokens { get; set; }
    public int ChatCalls { get; set; }
}
