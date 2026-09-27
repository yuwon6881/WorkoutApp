using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Xunit;

namespace Workout.Tests;

public sealed class MutationLockTests
{
    [Fact]
    public async Task Sqlite_read_can_repair_state_without_reacquiring_its_own_gate()
    {
        await using var first = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options);
        await using var second = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var read = await MutationLock.AcquireRead(first, timeout.Token);
        await using (var mutation = await MutationLock.Acquire(first, Guid.NewGuid(), timeout.Token))
            await mutation.Commit(timeout.Token);
        var competingRead = MutationLock.AcquireRead(second, timeout.Token);
        Assert.False(competingRead.IsCompleted);
        await read.DisposeAsync();
        await using var resumedRead = await competingRead;
    }
}
