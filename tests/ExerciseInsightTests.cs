using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Unknown load stays unknown, which means a finished session can hold completed sets and still
/// not state a single load. Every other record on the insight screen already reads as absent in
/// that case; the rep PR read the empty result as if it had a set behind it and crashed the whole
/// request with a NullReferenceException, taking the history and the chart down with it.
public sealed class ExerciseInsightTests
{
    [Fact]
    public async Task History_names_the_program_and_keeps_standalone_workouts_unlabelled()
    {
        var (h, templateId, benchId) = await Ready();
        await using var owned = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)],
                [new SetInput(60, 10, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
        var service = new ExerciseService(h.Db);
        Assert.Null(Assert.Single((await service.Insight(benchId, "all", 0, 20, default)).History).ProgramName);
        var program = new Workout.Api.Data.TrainingProgram { UserId = h.Db.CurrentUser!.Value, Name = "Strength block" };
        h.Db.Programs.Add(program);
        var savedSession = await h.Db.Workouts.FindAsync(h.Db.CurrentUser.Value, session.Id);
        savedSession!.ProgramId = program.Id;
        await h.Db.SaveChangesAsync();
        Assert.Equal("Strength block", Assert.Single((await service.Insight(benchId, "all", 0, 20, default)).History).ProgramName);
    }

    [Fact]
    public async Task Cached_full_history_insights_invalidate_after_completion_and_deletion()
    {
        var (h, templateId, benchId) = await Ready();
        await using var owned = h;
        using var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions { SizeLimit = 256 });
        var service = new ExerciseService(h.Db, cache);
        var empty = await service.Insight(benchId, "all", 0, 20, default);
        Assert.Same(empty, await service.Insight(benchId, "all", 0, 20, default));
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)], [new SetInput(60, 10, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
        var completed = await service.Insight(benchId, "all", 0, 20, default);
        Assert.Equal(1, completed.Sessions);
        Assert.NotSame(empty, completed);
        Assert.Equal(Json.Write(await new ExerciseService(h.Db).Insight(benchId, "all", 0, 20, default)), Json.Write(completed));
        await h.Workouts.DeleteFromHistory(session.Id, default);
        Assert.Equal(0, (await service.Insight(benchId, "all", 0, 20, default)).Sessions);
    }

    [Fact]
    public async Task Ranges_and_pages_cut_the_same_cached_history_as_an_uncached_read()
    {
        var (h, templateId, benchId) = await Ready();
        await using var owned = h;
        var sessionIds = new List<Guid>();
        foreach (var load in new[] { 60.0, 65.0 })
        {
            var session = await h.Workouts.Start(templateId, null, default);
            await h.Workouts.Save(session.Id, new SessionInput(null,
                [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)], [new SetInput(load, 10, 8, true)])],
                session.Revision, null), default);
            await h.Workouts.Finish(session.Id, null, default);
            sessionIds.Add(session.Id);
        }
        var older = await h.Db.Workouts.FindAsync(h.Db.CurrentUser!.Value, sessionIds[0]);
        older!.StartedAt = older.StartedAt.AddDays(-60);
        older.FinishedAt = older.FinishedAt!.Value.AddDays(-60);
        await h.Db.SaveChangesAsync();
        using var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions { SizeLimit = 256 });
        var cached = new ExerciseService(h.Db, cache);

        var month = await cached.Insight(benchId, "1m", 0, 1, default);
        var quarter = await cached.Insight(benchId, "3m", 1, 1, default);

        Assert.Equal(sessionIds[1], Assert.Single(month.Points).SessionId);
        Assert.Equal(sessionIds[1], Assert.Single(month.History).SessionId);
        Assert.Equal(2, quarter.Points.Count);
        Assert.Equal(sessionIds[0], Assert.Single(quarter.History).SessionId);
        Assert.All(new[] { month, quarter }, insight => Assert.Equal(2, insight.TotalHistoryRows));
        Assert.Equal((1, 1), (quarter.Page, quarter.Size));
        Assert.Equal(65, month.HeaviestKg);
        Assert.Equal(Json.Write(await new ExerciseService(h.Db).Insight(benchId, "3m", 1, 1, default)), Json.Write(quarter));
    }

    private static async Task<(Harness h, Guid templateId, Guid benchId)> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null));
        var benchId = await h.ExerciseId("bench");
        var template = await h.Templates.Create(
            Harness.Template("Push", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);
        return (h, template.Id, benchId);
    }

    [Fact]
    public async Task A_finished_session_whose_sets_state_no_load_reports_records_as_absent()
    {
        var (h, templateId, benchId) = await Ready();
        await using var _h = h;
        var exercises = new ExerciseService(h.Db);
        var session = await h.Workouts.Start(templateId, null, default);
        // Ten reps logged, the load never written down.
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)],
                [new SetInput(null, 10, null, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var insight = await exercises.Insight(benchId, "3m", 0, 20, default);

        Assert.Equal(1, insight.Sessions);
        Assert.Equal(1, insight.SetCount);
        Assert.Null(insight.RepPr);
        Assert.Null(insight.RepPrDate);
        Assert.Null(insight.HeaviestKg);
        Assert.Null(insight.LargestSetVolumeKg);
        // The session itself is still history, and it is honest about the missing load.
        Assert.Single(insight.History);
        Assert.True(insight.PartialVolume);
    }

    [Fact]
    public async Task A_logged_load_still_produces_a_rep_record()
    {
        var (h, templateId, benchId) = await Ready();
        await using var _h = h;
        var exercises = new ExerciseService(h.Db);
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)],
                [new SetInput(60, 10, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var insight = await exercises.Insight(benchId, "3m", 0, 20, default);

        Assert.Equal(10, insight.RepPr);
        Assert.NotNull(insight.RepPrDate);
        Assert.Equal(60, insight.HeaviestKg);
    }
}
