using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Workout.Tests;

/// Fails the database commands a test selects, so it can exercise what happens to the change
/// tracker and to later work after a write fails partway through.
internal sealed class FailingCommands : DbCommandInterceptor
{
    public Func<DbCommand, bool> Fails { get; set; } = _ => false;

    public static bool Mentions(DbCommand command, Guid id) => command.Parameters.Cast<DbParameter>()
        .Any(parameter => string.Equals(parameter.Value?.ToString(), id.ToString(), StringComparison.OrdinalIgnoreCase));

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
        CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken ct = default)
    {
        Check(command);
        return ValueTask.FromResult(result);
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command,
        CommandEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
    {
        Check(command);
        return ValueTask.FromResult(result);
    }

    private void Check(DbCommand command)
    {
        if (Fails(command)) throw new InvalidOperationException("Injected database failure.");
    }
}
