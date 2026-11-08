using System.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Workout.Api.Data;

/// Development SQLite databases are created without EF migrations. Keep this additive capability
/// compatible with an existing database rather than requiring its programs to be deleted.
internal static class SqliteImportCompatibility
{
    public static async Task EnsureEffortCapability(AppDb db, CancellationToken ct)
    {
        if (!db.Database.IsSqlite()) return;
        var connection = db.Database.GetDbConnection();
        var openedHere = connection.State != ConnectionState.Open;
        if (openedHere) await connection.OpenAsync(ct);
        try
        {
            async Task<bool> HasColumn()
            {
                await using var command = connection.CreateCommand();
                command.CommandText = "PRAGMA table_info(\"Programs\")";
                await using var rows = await command.ExecuteReaderAsync(ct);
                while (await rows.ReadAsync(ct))
                    if (string.Equals(rows.GetString(1), "AllowUnspecifiedEffort", StringComparison.OrdinalIgnoreCase)) return true;
                return false;
            }

            if (await HasColumn()) return;
            try
            {
                await using var command = connection.CreateCommand();
                command.CommandText = "ALTER TABLE \"Programs\" ADD COLUMN \"AllowUnspecifiedEffort\" INTEGER NOT NULL DEFAULT 0";
                await command.ExecuteNonQueryAsync(ct);
            }
            catch (SqliteException error) when (error.SqliteErrorCode == 1)
            {
                // Another development process may have added the column after our check.
                if (!await HasColumn()) throw;
            }
        }
        finally { if (openedHere) await connection.CloseAsync(); }
    }
}
