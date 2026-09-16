using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Optional in-process worker for deployments that do not yet run a dedicated Cloud Tasks
/// service. It resumes persisted extraction chunks after a browser closes; the per-account
/// mutation lock makes browser and worker delivery idempotent.
public sealed class ImportExtractionWorker(IServiceScopeFactory scopes, IConfiguration config, ILogger<ImportExtractionWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Cloud Tasks is the production delivery path. Polling remains an explicit local/fallback
        // option, but a permanently warm Cloud Run instance must not be required for normal imports.
        if (!config.GetValue("ImportWorker:PollingEnabled", false)) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                var imports = scope.ServiceProvider.GetRequiredService<ImportService>();
                var pending = await db.Imports.IgnoreQueryFilters().AsNoTracking()
                    .Where(i => i.Status == ImportStatus.Pending && i.Stage == "extract" && i.SourceFileKey != "")
                    .OrderBy(i => i.Created).Select(i => new { i.Id, i.UserId }).Take(4).ToListAsync(stoppingToken);
                foreach (var item in pending)
                {
                    db.CurrentUser = item.UserId;
                    try { await imports.Extract(item.Id, [], "", stoppingToken); }
                    catch (DomainException ex) { log.LogInformation("Import chunk {ImportId} remains retryable: {Message}", item.Id, ex.Message); }
                    catch (Exception ex) { log.LogWarning(ex, "Import worker failed for {ImportId}; it will retry later.", item.Id); }
                    finally { db.ChangeTracker.Clear(); db.CurrentUser = null; }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex) { log.LogWarning(ex, "Import worker pass failed; it will retry later."); }
        }
    }
}
