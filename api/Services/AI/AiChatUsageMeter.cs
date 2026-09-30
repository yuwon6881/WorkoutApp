using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services.AI;

// UTC accounting is separate from the profile-local dates used by nutrition/training tools.
public sealed class AiChatUsageMeter(AppDb db, ILogger<AiChatUsageMeter> logger)
{
    public async Task<bool> HasBudgetAsync(long dailyTokenLimit, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var spent = await db.Usage.AsNoTracking().Where(u => u.Date == today)
            .Select(u => u.ChatInputTokens + u.ChatOutputTokens).FirstOrDefaultAsync(ct);
        return spent < dailyTokenLimit;
    }

    public async Task RecordAsync(AiTokenUsage usage, int rounds, CancellationToken cancellationToken)
    {
        if (rounds <= 0) return;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var userId = db.CurrentUser ?? throw new InvalidOperationException("No authenticated user.");
        // Atomic increments cannot lose another request's usage, or detach its pending turn.
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var updated = await db.Usage.Where(u => u.UserId == userId && u.Date == today)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(u => u.ChatInputTokens, u => u.ChatInputTokens + usage.InputTokens)
                    .SetProperty(u => u.ChatCachedTokens, u => u.ChatCachedTokens + usage.CachedTokens)
                    .SetProperty(u => u.ChatOutputTokens, u => u.ChatOutputTokens + usage.OutputTokens)
                    .SetProperty(u => u.ChatReasoningTokens, u => u.ChatReasoningTokens + usage.ReasoningTokens)
                    .SetProperty(u => u.ChatCalls, u => u.ChatCalls + 1)
                    .SetProperty(u => u.UpdatedAt, DateTime.UtcNow), cancellationToken);
            if (updated > 0)
            {
                var tracked = db.Usage.Local.FirstOrDefault(u => u.UserId == userId && u.Date == today);
                if (tracked != null) await db.Entry(tracked).ReloadAsync(cancellationToken);
                return;
            }
            var row = new AiUsage
            {
                UserId = userId, Date = today, ChatInputTokens = usage.InputTokens,
                ChatCachedTokens = usage.CachedTokens, ChatOutputTokens = usage.OutputTokens,
                ChatReasoningTokens = usage.ReasoningTokens, ChatCalls = 1, UpdatedAt = DateTime.UtcNow
            };
            db.Usage.Add(row);
            try { await db.SaveChangesAsync(cancellationToken); return; }
            catch (DbUpdateException) when (attempt == 0)
            {
                db.Entry(row).State = EntityState.Detached;
            }
        }
        logger.LogWarning("Ask AI usage could not be recorded after 2 attempts.");
    }
}
