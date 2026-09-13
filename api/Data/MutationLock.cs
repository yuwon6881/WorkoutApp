using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Workout.Api.Data;

// SQLite is for isolated local development/tests. Production serialization is database-wide.
public sealed class MutationLock : IAsyncDisposable
{
    private static readonly SemaphoreSlim LocalGate = new(1);
    private IDbContextTransaction? transaction;
    private bool local;
    public static async Task<MutationLock> Acquire(AppDb db, Guid? user, CancellationToken ct)
    {
        var result = new MutationLock();
        result.local = db.Database.IsSqlite();
        if (result.local) await LocalGate.WaitAsync(ct);
        try
        {
            result.transaction = await db.Database.BeginTransactionAsync(ct);
            if (!result.local)
            {
                var key = user == null ? 918273L : BitConverter.ToInt64(user.Value.ToByteArray());
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({key})", ct);
            }
            return result;
        }
        catch { await result.DisposeAsync(); throw; }
    }
    public async Task Commit(CancellationToken ct) => await transaction!.CommitAsync(ct);
    public async ValueTask DisposeAsync()
    {
        if (transaction != null) await transaction.DisposeAsync();
        if (local) { local = false; LocalGate.Release(); }
    }
}
