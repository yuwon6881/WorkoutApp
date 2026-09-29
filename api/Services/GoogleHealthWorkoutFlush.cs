namespace Workout.Api.Services;

/// Sends a user's queued workout uploads while they are already in a request, when the API and
/// database are awake, so no scheduled job has to wake either of them just to upload. Anything a
/// bounded pass leaves queued goes out on the user's next visit or in the daily maintenance sweep.
public static class GoogleHealthWorkoutFlush
{
    /// Bounds the flush that rides on a user's own request so it never noticeably delays it.
    public static readonly TimeSpan ActiveUserBudget = TimeSpan.FromSeconds(6);

    public static async Task ForActiveUserAsync(IServiceScopeFactory scopes, Guid? userId, ILogger logger, CancellationToken ct)
    {
        if (userId is null) return;
        try
        {
            // Own scope: the request's DbContext just finished a mutation and is not reused for a second unit of work.
            await using var scope = scopes.CreateAsyncScope();
            var sync = scope.ServiceProvider.GetRequiredService<GoogleHealthWorkoutSyncService>();
            await sync.ProcessDueAsync(ct, userId, ActiveUserBudget);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Google Health workout uploads were left queued for the next visit or daily sweep: {FailureType}.", ex.GetType().Name);
        }
    }
}
