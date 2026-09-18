using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using Workout.Api.Data;

namespace Workout.Api.Services;

/// Starts long-running extraction passes outside the HTTP request. Cloud Run may recycle an
/// instance, so the client can safely kick an unfinished import again; only one pass for an import
/// is allowed in this process and the database's prefix-commit rules make a second instance safe.
public sealed class ImportRunner(IServiceScopeFactory scopes, ILogger<ImportRunner> log)
{
    private readonly ConcurrentDictionary<Guid, TaskCompletionSource<object?>> running = new();

    public bool Start(Guid importId, Guid userId)
    {
        var completion = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!running.TryAdd(importId, completion)) return false;
        _ = Task.Run(() => Run(importId, userId, completion));
        return true;
    }

    /// Tests and operational callers can await the pass without sleeping for an arbitrary amount
    /// of time. A completed task means that no pass is currently registered for this import.
    public Task WaitForIdle(Guid importId)
        => running.TryGetValue(importId, out var completion) ? completion.Task : Task.CompletedTask;

    private async Task Run(Guid importId, Guid userId, TaskCompletionSource<object?> completion)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            db.CurrentUser = userId;
            await scope.ServiceProvider.GetRequiredService<ImportService>().RunExtract(importId, CancellationToken.None);
        }
        catch (Exception ex)
        {
            // RunExtract records a retryable error on the row. The runner must not surface an
            // unobserved task exception because the request that kicked it has already returned.
            log.LogWarning(ex, "Background PDF extraction failed for import {ImportId}.", importId);
        }
        finally
        {
            running.TryRemove(importId, out _);
            completion.TrySetResult(null);
        }
    }
}
