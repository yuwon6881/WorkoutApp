using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using System.Runtime.CompilerServices;

namespace Workout.Api.Data;

// SQLite is for isolated local development/tests. Production serialization is database-wide.
public sealed class MutationLock : IAsyncDisposable
{
    private static readonly SemaphoreSlim LocalGate = new(1);
    private static readonly ConditionalWeakTable<AppDb, ReadLock> ReadOwners = new();
    private IDbContextTransaction? transaction;
    private bool local;
    public static async Task<MutationLock> Acquire(AppDb db, Guid? user, CancellationToken ct)
    {
        var result = new MutationLock();
        // A GET can repair an active program under its existing SQLite read
        // gate. Reuse that ownership instead of waiting on the same semaphore.
        result.local = db.Database.IsSqlite() && !ReadOwners.TryGetValue(db, out _);
        if (result.local) await LocalGate.WaitAsync(ct);
        try
        {
            result.transaction = await db.Database.BeginTransactionAsync(ct);
            if (!db.Database.IsSqlite())
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

    public static async Task<IAsyncDisposable> AcquireRead(AppDb db, CancellationToken ct)
    {
        if (!db.Database.IsSqlite()) return NoopLock.Instance;
        await LocalGate.WaitAsync(ct);
        var owner = new ReadLock(db);
        ReadOwners.Add(db, owner);
        return owner;
    }

    private sealed class ReadLock(AppDb db) : IAsyncDisposable
    {
        public ValueTask DisposeAsync()
        {
            ReadOwners.Remove(db);
            LocalGate.Release();
            return ValueTask.CompletedTask;
        }
    }

    private sealed class NoopLock : IAsyncDisposable
    {
        public static readonly NoopLock Instance = new();
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
