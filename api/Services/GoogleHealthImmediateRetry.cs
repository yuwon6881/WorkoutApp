namespace Workout.Api.Services;

/// <summary>
/// A bounded, immediate retry for Google Health calls that failed in a way that is safe to repeat, so a brief
/// Google or network hiccup does not leave an upload waiting for the next visit or the daily sweep. It makes two
/// more attempts, after about half a second and one and a half seconds; a shorter pause the provider asks for
/// replaces those, and a longer one is left to the queue's own backoff. It never repeats a create whose outcome is
/// unknown (a duplicate could exist) or an authentication failure, and never swallows cancellation. Whatever
/// survives the retries is thrown unchanged for the normal queue handling.
/// </summary>
internal static class GoogleHealthImmediateRetry
{
    private static readonly TimeSpan[] Backoff = [TimeSpan.FromMilliseconds(500), TimeSpan.FromMilliseconds(1500)];

    /// Beyond this the retry would hold a user's response open; leave it to the queue.
    public static readonly TimeSpan LongestWait = TimeSpan.FromSeconds(3);

    public static async Task<GoogleHealthOperationResult> RunAsync(
        Func<Task<GoogleHealthOperationResult>> call,
        CancellationToken ct,
        Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        var wait = delay ?? ((pause, token) => Task.Delay(pause + TimeSpan.FromMilliseconds(Random.Shared.Next(0, 200)), token));
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await call();
            }
            catch (GoogleHealthWorkoutProviderException ex) when (!ct.IsCancellationRequested
                && ex is { Transient: true, UnknownCreate: false, AuthenticationFailure: false }
                && attempt < Backoff.Length
                && (ex.RetryAfter ?? Backoff[attempt]) <= LongestWait)
            {
                await wait(ex.RetryAfter ?? Backoff[attempt], ct);
            }
        }
    }
}
