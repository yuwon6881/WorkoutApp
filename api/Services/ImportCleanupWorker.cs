using Microsoft.Extensions.DependencyInjection;

namespace Workout.Api.Services;

/// Sweeps stale imports and other expired rows between the daily maintenance requests.
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
