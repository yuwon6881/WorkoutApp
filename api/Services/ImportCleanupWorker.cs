using Microsoft.Extensions.DependencyInjection;

namespace Workout.Api.Services;

/// Removes abandoned source objects and marks unfinished imports failed. The short interval keeps
/// the temporary store bounded; the database expiry check remains the source of truth.
public sealed class ImportCleanupWorker(IServiceScopeFactory scopes, ILogger<ImportCleanupWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<ImportService>().CleanupExpired(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex) { log.LogWarning(ex, "Transient import cleanup failed; it will retry on the next interval."); }
        }
    }
}
