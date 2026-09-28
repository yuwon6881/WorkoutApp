using System.Data.Common;
using System.Diagnostics.Metrics;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Workout.Api.Services;

/// Measures completed commands, rather than the interceptor's pre-execution callback.
/// Tags never include SQL text, accounts, or request content.
public sealed class DatabaseMetricsInterceptor : DbCommandInterceptor
{
    private static readonly Meter Meter = new("Fitness.Workout.Database", "1.0");
    private static readonly Counter<long> CommandCount = Meter.CreateCounter<long>("db.command.count");
    private static readonly Histogram<double> CommandDuration = Meter.CreateHistogram<double>("db.command.duration", "ms");

    public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
        DbDataReader result, CancellationToken cancellationToken = default)
    {
        Record(command, eventData.Duration);
        return ValueTask.FromResult(result);
    }

    public override ValueTask<object?> ScalarExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
        object? result, CancellationToken cancellationToken = default)
    {
        Record(command, eventData.Duration);
        return ValueTask.FromResult(result);
    }

    public override ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
        int result, CancellationToken cancellationToken = default)
    {
        Record(command, eventData.Duration);
        return ValueTask.FromResult(result);
    }

    public override Task CommandFailedAsync(DbCommand command, CommandErrorEventData eventData,
        CancellationToken cancellationToken = default)
    {
        Record(command, eventData.Duration);
        return Task.CompletedTask;
    }

    private static void Record(DbCommand command, TimeSpan duration)
    {
        var operation = command.CommandText.TrimStart() switch
        {
            ['S', 'E', 'L', 'E', 'C', 'T', ..] or ['s', 'e', 'l', 'e', 'c', 't', ..] => "select",
            ['I', 'N', 'S', 'E', 'R', 'T', ..] or ['i', 'n', 's', 'e', 'r', 't', ..] => "insert",
            ['U', 'P', 'D', 'A', 'T', 'E', ..] or ['u', 'p', 'd', 'a', 't', 'e', ..] => "update",
            ['D', 'E', 'L', 'E', 'T', 'E', ..] or ['d', 'e', 'l', 'e', 't', 'e', ..] => "delete",
            _ => "other"
        };
        var tag = new KeyValuePair<string, object?>("operation", operation);
        CommandCount.Add(1, tag);
        CommandDuration.Record(duration.TotalMilliseconds, tag);
    }
}
