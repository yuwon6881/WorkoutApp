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
    public async Task History_keeps_the_program_name_after_the_program_is_deleted()
    {
        var (h, _, benchId) = await Ready();
        await using var owned = h;
        var program = await h.Programs.Create(new ProgramInput("Strength block",
            [new ProgramWorkoutInput(1, "Day A", "Push", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))])]), true, null, default);
        var session = await h.Workouts.Start(program.Workouts[0].Id, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)],
                [new SetInput(60, 10, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
        var service = new ExerciseService(h.Db);

        await h.Programs.Delete(program.Id, default);

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

    [Fact]
    public async Task A_session_row_pairs_its_heaviest_load_with_that_sets_reps()
    {
        // 70 kg for 5, then a 60 kg back-off set for 7: the row must read 70 kg x 5, not 70 kg x 7,
        // which no set ever did.
        var (h, templateId, benchId) = await Ready();
        await using var owned = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(5, 8), Harness.Set(5, 8)],
                [new SetInput(70, 5, null, true), new SetInput(60, 7, null, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var point = Assert.Single((await new ExerciseService(h.Db).Insight(benchId, "all", 0, 20, default)).Points);

        Assert.Equal(70, point.LoadKg);
        Assert.Equal(5, point.Reps);
    }

    [Fact]
    public async Task An_unrated_set_is_estimated_on_the_chart_as_it_is_in_session_records()
    {
        // Session records and %1RM loads read an unrated set at face value; the strength chart must
        // not drop the same set, or a record could be announced that the chart never shows.
        var (h, templateId, benchId) = await Ready();
        await using var owned = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(5, 8)], [new SetInput(70, 5, null, true)])],
            session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var insight = await new ExerciseService(h.Db).Insight(benchId, "all", 0, 20, default);

        Assert.Equal(Progression.Estimate1Rm(70, 5), Assert.Single(insight.Points).Estimated1RmKg);
    }

    [Fact]
    public async Task Dates_follow_the_readers_time_zone_rather_than_utc()
    {
        // Finished at 23:30 UTC on 10 March, which is already 11 March in Kuala Lumpur (UTC+8).
        var (h, templateId, benchId) = await Ready();
        await using var owned = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)],
                [new SetInput(60, 10, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
        var stored = h.Db.Workouts.Single(workout => workout.Id == session.Id);
        stored.FinishedAt = new DateTime(2026, 3, 10, 23, 30, 0, DateTimeKind.Utc);
        await h.Db.SaveChangesAsync();

        var local = await new ExerciseService(h.Db).Insight(benchId, "all", 0, 20, default, "Asia/Kuala_Lumpur");
        var utc = await new ExerciseService(h.Db).Insight(benchId, "all", 0, 20, default);

        var expected = new DateOnly(2026, 3, 11);
        Assert.Equal(expected, Assert.Single(local.Points).Date);
        Assert.Equal(expected, Assert.Single(local.History).Date);
        Assert.Equal(expected, local.Estimated1RmDate);
        Assert.Equal(expected, local.HeaviestDate);
        Assert.Equal(expected, local.LastPerformedDate);
        Assert.Equal(new DateOnly(2026, 3, 10), Assert.Single(utc.Points).Date);
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

    [Fact]
    public async Task Insight_handles_two_thousand_historical_sessions_smoothly()
    {
        var (h, _, benchId) = await Ready();
        await using var owned = h;
        var userId = h.Db.CurrentUser!.Value;
        var start = DateTime.UtcNow.AddDays(-2000);

        var workouts = new List<Workout.Api.Data.WorkoutSession>(2000);
        var sessionExercises = new List<Workout.Api.Data.SessionExercise>(2000);
        var sets = new List<Workout.Api.Data.CompletedSet>(2000);

        for (var i = 0; i < 2000; i++)
        {
            var workoutId = Guid.NewGuid();
            var exerciseRowId = Guid.NewGuid();
            var finish = start.AddDays(i);
            workouts.Add(new Workout.Api.Data.WorkoutSession
            {
                UserId = userId,
                Id = workoutId,
                Name = $"Workout {i + 1}",
                StartedAt = finish.AddHours(-1),
                FinishedAt = finish,
                Active = false
            });
            sessionExercises.Add(new Workout.Api.Data.SessionExercise
            {
                UserId = userId,
                Id = exerciseRowId,
                SessionId = workoutId,
                ExerciseId = benchId,
                Position = 0,
                LoadModel = LoadModels.External
            });
            sets.Add(new Workout.Api.Data.CompletedSet
            {
                UserId = userId,
                Id = Guid.NewGuid(),
                SessionExerciseId = exerciseRowId,
                Position = 0,
                WeightKg = 60.0 + (i % 40),
                Reps = 5 + (i % 5),
                Done = true,
                Warmup = false
            });
        }

        h.Db.Workouts.AddRange(workouts);
        h.Db.SessionExercises.AddRange(sessionExercises);
        h.Db.Sets.AddRange(sets);
        await h.Db.SaveChangesAsync();

        var service = new ExerciseService(h.Db);

        var full = await service.Insight(benchId, "all", 0, 20, default);
        Assert.Equal(2000, full.Sessions);
        Assert.Equal(2000, full.TotalHistoryRows);
        Assert.Equal(2000, full.Points.Count);
        Assert.Equal(20, full.History.Count);

        var page1 = await service.Insight(benchId, "all", 1, 20, default);
        Assert.Equal(20, page1.History.Count);
        Assert.NotEqual(full.History[0].SessionId, page1.History[0].SessionId);

        var month = await service.Insight(benchId, "1m", 0, 20, default);
        Assert.Equal(2000, month.TotalHistoryRows);
        Assert.True(month.Points.Count < 2000);
    }
}
