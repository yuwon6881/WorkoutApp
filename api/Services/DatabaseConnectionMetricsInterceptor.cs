using System.Data.Common;
using System.Diagnostics.Metrics;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Workout.Api.Services;

/// Connection acquisition includes pool waits and new-connection handshakes, separately from SQL.
public sealed class DatabaseConnectionMetricsInterceptor : DbConnectionInterceptor
{
    private static readonly Meter Meter = new("Fitness.Workout.Database", "1.0");
    private static readonly Histogram<double> Duration = Meter.CreateHistogram<double>("db.connection.open.duration", "ms");

    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
        => Record(eventData.Duration, "success");

    public override Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData,
        CancellationToken cancellationToken = default)
    { Record(eventData.Duration, "success"); return Task.CompletedTask; }

    public override void ConnectionFailed(DbConnection connection, ConnectionErrorEventData eventData)
        => Record(eventData.Duration, "failed");

    public override Task ConnectionFailedAsync(DbConnection connection, ConnectionErrorEventData eventData,
        CancellationToken cancellationToken = default)
    { Record(eventData.Duration, "failed"); return Task.CompletedTask; }

    private static void Record(TimeSpan elapsed, string outcome)
        => Duration.Record(elapsed.TotalMilliseconds, new KeyValuePair<string, object?>("outcome", outcome));
}
