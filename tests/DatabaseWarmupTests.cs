using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class DatabaseWarmupTests
{
    [Fact]
    public async Task A_recent_probe_answers_later_calls_without_touching_the_database()
    {
        var clock = new SteppedClock();
        var warmup = new DatabaseWarmup(NullLogger<DatabaseWarmup>.Instance, clock);
        await using var working = Open("Data Source=:memory:");
        await using var unreachable = Open("Data Source=/nonexistent-warmup-directory/workout.db;Mode=ReadOnly");

        Assert.True(await warmup.EnsureAwakeAsync(working, default));
        // Inside the window the unreachable database is never queried, so the call still succeeds.
        Assert.True(await warmup.EnsureAwakeAsync(unreachable, default));

        clock.Advance(TimeSpan.FromSeconds(31));
        Assert.False(await warmup.EnsureAwakeAsync(unreachable, default));
    }

    [Fact]
    public async Task A_failed_probe_is_reported_and_not_remembered()
    {
        var warmup = new DatabaseWarmup(NullLogger<DatabaseWarmup>.Instance, new SteppedClock());
        await using var unreachable = Open("Data Source=/nonexistent-warmup-directory/workout.db;Mode=ReadOnly");
        await using var working = Open("Data Source=:memory:");

        Assert.False(await warmup.EnsureAwakeAsync(unreachable, default));
        Assert.True(await warmup.EnsureAwakeAsync(working, default));
    }

    [Fact]
    public async Task Cancellation_is_not_reported_as_an_unavailable_database()
    {
        var warmup = new DatabaseWarmup(NullLogger<DatabaseWarmup>.Instance, new SteppedClock());
        await using var working = Open("Data Source=:memory:");
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => warmup.EnsureAwakeAsync(working, cancelled.Token));
    }

    private static AppDb Open(string connection) => new(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);

    private sealed class SteppedClock : TimeProvider
    {
        private DateTimeOffset now = new(2026, 10, 25, 8, 0, 0, TimeSpan.Zero);
        public void Advance(TimeSpan by) => now += by;
        public override DateTimeOffset GetUtcNow() => now;
    }
}
