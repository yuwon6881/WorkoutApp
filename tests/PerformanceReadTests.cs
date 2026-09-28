using System.Data.Common;
using System.Diagnostics;
using System.Text.Json;
using Xunit.Abstractions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

[Collection("Performance")]
public sealed class PerformanceReadTests(ITestOutputHelper output)
{
    private sealed class Commands : DbCommandInterceptor
    {
        public List<string> Sql { get; } = [];
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken ct = default)
        { Sql.Add(command.CommandText); return ValueTask.FromResult(result); }
    }

    private static async Task<WorkoutSession> Add(Harness h, DateTime finished, double weight, int reps)
    {
        var session = new WorkoutSession { UserId = h.Db.CurrentUser!.Value, Name = "Bench", Active = false,
            StartedAt = finished.AddHours(-1), FinishedAt = finished };
        var exercise = new SessionExercise { UserId = session.UserId, SessionId = session.Id, NameSnapshot = "Bench",
            LoadModel = LoadModels.External };
        h.Db.Workouts.Add(session); h.Db.SessionExercises.Add(exercise);
        h.Db.Sets.Add(new CompletedSet { UserId = session.UserId, SessionExerciseId = exercise.Id,
            WeightKg = weight, Reps = reps, Rpe = 8, Done = true });
        await h.Db.SaveChangesAsync();
        return session;
    }

    [Fact]
    public async Task Summaries_match_reference_after_append_and_history_deletion()
    {
        await using var h = await Harness.Create(); await h.SignIn();
        var first = await Add(h, DateTime.UtcNow.AddDays(-3), 50, 8);
        var second = await Add(h, DateTime.UtcNow.AddDays(-2), 50, 10);
        await AssertParity(h, [first, second]);
        var third = await Add(h, DateTime.UtcNow.AddDays(-1), 50, 12);
        await AssertParity(h, [first, second, third]);
        await h.Workouts.DeleteFromHistory(second.Id, default);
        await AssertParity(h, [first, third]);
        // A backdated offline completion must rebuild chronological attribution.
        var backdated = await Add(h, DateTime.UtcNow.AddDays(-4), 50, 15);
        await AssertParity(h, [backdated, first, third]);
    }

    [Fact]
    public async Task Tied_session_timestamps_keep_deterministic_attribution_across_rebuild_pages()
    {
        await using var h = await Harness.Create(); await h.SignIn();
        var finished = DateTime.UtcNow.AddDays(-1);
        var sessions = new List<WorkoutSession>();
        for (var i = 0; i < 70; i++) sessions.Add(await Add(h, finished, 50 + i, 8));
        await AssertParity(h, sessions);
        await h.Workouts.DeleteFromHistory(sessions[10].Id, default);
        sessions.RemoveAt(10);
        await AssertParity(h, sessions);
    }

    private static async Task AssertParity(Harness h, List<WorkoutSession> sessions)
    {
        var expected = await WorkoutViewBuilder.ComputePrs(h.Db, sessions, default);
        var actual = await WorkoutPrReadService.Get(h.Db, sessions, default);
        Assert.Equal(expected.ExercisePrs.OrderBy(x => x.Key), actual.ExercisePrs.OrderBy(x => x.Key));
        Assert.Equal(expected.SetPrs.OrderBy(x => x.Key), actual.SetPrs.OrderBy(x => x.Key));
        foreach (var session in sessions) Assert.Equal(expected.SessionPrCounts.GetValueOrDefault(session.Id), actual.SessionPrCounts.GetValueOrDefault(session.Id));
        Assert.Equal(expected.Bests.OrderBy(x => x.Key), actual.Bests.OrderBy(x => x.Key));
        Assert.Equal(Json.Write(expected.RepBests.PreviousByExercise.Values), Json.Write(actual.RepBests.PreviousByExercise.Values));
    }

    [Fact]
    public async Task Editing_a_non_maximum_row_invalidates_and_rollback_preserves_generations()
    {
        await using var h = await Harness.Create(); await h.SignIn();
        var first = await Add(h, DateTime.UtcNow.AddDays(-3), 50, 8);
        var second = await Add(h, DateTime.UtcNow.AddDays(-2), 50, 10);
        second.Revision = 100; await h.Db.SaveChangesAsync();
        await AssertParity(h, [first, second]);
        var before = await h.Db.ResourceGenerations.AsNoTracking().SingleAsync();
        first.Note = "Edited old history"; await h.Db.SaveChangesAsync();
        var after = await h.Db.ResourceGenerations.AsNoTracking().SingleAsync();
        Assert.True(after.History > before.History);
        await using (var transaction = await h.Db.Database.BeginTransactionAsync())
        {
            first.Note = "Will roll back"; await h.Db.SaveChangesAsync();
            await transaction.RollbackAsync();
        }
        Assert.Equal(after.History, (await h.Db.ResourceGenerations.AsNoTracking().SingleAsync()).History);
    }

    [Theory]
    [InlineData(0)] [InlineData(100)] [InlineData(1000)] [InlineData(3000)]
    public async Task Warm_reads_do_not_scan_history_as_accounts_grow(int count)
    {
        var commands = new Commands();
        await using var h = await Harness.Create(observer: commands); await h.SignIn();
        var first = DateTime.UtcNow.AddDays(-count);
        // A single source transaction is deliberately used for the fixture; normal users finish one session at a time.
        for (var i = 0; i < count; i++)
        {
            var workout = new WorkoutSession { UserId = h.Db.CurrentUser!.Value, Name = "Fixture", Active = false,
                StartedAt = first.AddDays(i), FinishedAt = first.AddDays(i).AddHours(1) };
            var exercise = new SessionExercise { UserId = workout.UserId, SessionId = workout.Id, NameSnapshot = "Bench" };
            h.Db.Workouts.Add(workout); h.Db.SessionExercises.Add(exercise);
            h.Db.Sets.Add(new CompletedSet { UserId = workout.UserId, SessionExerciseId = exercise.Id, WeightKg = 50, Reps = 8, Rpe = 8, Done = true });
        }
        await h.Db.SaveChangesAsync();
        var active = new WorkoutSession { UserId = h.Db.CurrentUser!.Value, Name = "Active", Active = true };
        var activeExercise = new SessionExercise { UserId = active.UserId, SessionId = active.Id, NameSnapshot = "Bench" };
        var activeSet = new CompletedSet { UserId = active.UserId, SessionExerciseId = activeExercise.Id, WeightKg = 50, Reps = 8 };
        h.Db.Workouts.Add(active); h.Db.SessionExercises.Add(activeExercise); h.Db.Sets.Add(activeSet);
        await h.Db.SaveChangesAsync();
        await WorkoutPrReadService.Get(h.Db, [active], default);
        using var cache = new MemoryCache(new MemoryCacheOptions());
        await ProgressReadService.Get(h.Db, cache, default);
        commands.Sql.Clear();
        await WorkoutPrReadService.Get(h.Db, [active], default);
        await ProgressReadService.Get(h.Db, cache, default);
        Assert.DoesNotContain(commands.Sql, sql => sql.Contains("FROM \"Sets\"") || sql.Contains("FROM \"Workouts\""));
        Assert.InRange(commands.Sql.Count, 1, 5);
        commands.Sql.Clear();
        // Real requests do not track the thousands of source rows used to seed this fixture.
        h.Db.ChangeTracker.Clear();
        var currentRevision = active.Revision;
        var timings = new List<double>();
        for (var i = 0; i < 10; i++)
        {
            var timer = Stopwatch.StartNew();
            var payload = JsonSerializer.SerializeToElement(new { revision = currentRevision, reps = 8 + i, mutationId = Guid.NewGuid() });
            var saved = await h.Workouts.PatchSet(active.Id, activeSet.Id, payload, default);
            currentRevision = saved.Revision;
            timings.Add(timer.Elapsed.TotalMilliseconds);
        }
        Assert.DoesNotContain(commands.Sql, sql => sql.Contains("JOIN \"Workouts\"") && sql.Contains("FinishedAt"));
        Assert.InRange(commands.Sql.Count / 10, 1, 20);
        output.WriteLine($"History={count}; warm set-patch p95={timings.Order().ElementAt(9):F2} ms; SQL/save={commands.Sql.Count / 10}");
        // A process-cache miss also reads the durable aggregate rather than replaying source history.
        cache.Compact(1); commands.Sql.Clear();
        await ProgressReadService.Get(h.Db, cache, default);
        Assert.DoesNotContain(commands.Sql, sql => sql.Contains("FROM \"Sets\""));
    }
}
