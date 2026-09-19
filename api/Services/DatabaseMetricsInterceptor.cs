using System.Data.Common;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Workout.Api.Services;

/// Records low-cardinality database work for the baseline dashboard. The interceptor deliberately
/// records command kind rather than SQL text or account identifiers so diagnostics cannot become a
/// second data store for private request content.
public sealed class DatabaseMetricsInterceptor : DbCommandInterceptor
{
    private static readonly Meter Meter = new("Fitness.Workout.Database", "1.0");
    private static readonly Counter<long> CommandCount = Meter.CreateCounter<long>("db.command.count");
    private static readonly Histogram<double> CommandDuration = Meter.CreateHistogram<double>("db.command.duration", "ms");

    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        var started = Stopwatch.GetTimestamp();
        try { return await base.ReaderExecutingAsync(command, eventData, result, cancellationToken); }
        finally { Record(command, started); }
    }

    public override async ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<object> result,
        CancellationToken cancellationToken = default)
    {
        var started = Stopwatch.GetTimestamp();
        try { return await base.ScalarExecutingAsync(command, eventData, result, cancellationToken); }
        finally { Record(command, started); }
    }

    public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        var started = Stopwatch.GetTimestamp();
        try { return await base.NonQueryExecutingAsync(command, eventData, result, cancellationToken); }
        finally { Record(command, started); }
    }

    private static void Record(DbCommand command, long started)
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
        CommandDuration.Record(Stopwatch.GetElapsedTime(started).TotalMilliseconds, tag);
    }
}
