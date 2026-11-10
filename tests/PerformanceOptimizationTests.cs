using System.Data.Common;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class PerformanceOptimizationTests
{
    private sealed class Commands : DbCommandInterceptor
    {
        public List<string> Sql { get; } = [];
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken ct = default)
        {
            Sql.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }
    }

    [Fact]
    public async Task Latest_exercise_selection_is_in_sql_and_timestamp_ties_are_deterministic()
    {
        var commands = new Commands();
        await using var h = await Harness.Create(observer: commands);
        var user = await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null));
        var exerciseId = await h.ExerciseId("bench");
        var finished = DateTime.UtcNow.AddDays(-1);
        var ids = new[] { Guid.Parse("00000000-0000-0000-0000-000000000001"), Guid.Parse("00000000-0000-0000-0000-000000000002") };
        foreach (var id in ids)
        {
            var session = new WorkoutSession { UserId = user.Id, Active = false, FinishedAt = finished };
            h.Db.Workouts.Add(session);
            h.Db.SessionExercises.Add(new SessionExercise { Id = id, UserId = user.Id, SessionId = session.Id, ExerciseId = exerciseId });
            h.Db.Sets.Add(new CompletedSet { UserId = user.Id, SessionExerciseId = id, Done = true, WeightKg = id == ids[1] ? 80 : 100, Reps = 8 });
        }
        await h.Db.SaveChangesAsync();
        commands.Sql.Clear();
        var row = Assert.Single(await new ExerciseService(h.Db).LastPerformed(default));
        Assert.Equal(80, row.WeightKg);
        Assert.Contains(commands.Sql, sql => sql.Contains("ROW_NUMBER", StringComparison.OrdinalIgnoreCase)
            || sql.Contains("NOT EXISTS", StringComparison.OrdinalIgnoreCase));
        await h.SignIn("other");
        Assert.Empty(await new ExerciseService(h.Db).LastPerformed(default));
    }

    [Fact]
    public async Task Cursor_pages_do_not_recount_history_and_return_no_total()
    {
        var commands = new Commands();
        await using var h = await Harness.Create(observer: commands);
        var user = await h.SignIn();
        var finished = DateTime.UtcNow.AddDays(-1);
        var session = new WorkoutSession { UserId = user.Id, Active = false, FinishedAt = finished };
        h.Db.Workouts.Add(session);
        await h.Db.SaveChangesAsync();
        var first = JsonSerializer.SerializeToElement(await HistoryReadService.Get(h.Db, null, null, 1, default));
        Assert.Equal(1, first.GetProperty("total").GetInt32());
        commands.Sql.Clear();
        var next = JsonSerializer.SerializeToElement(await HistoryReadService.Get(h.Db, finished, session.Id, 1, default, includeTotal: false));
        Assert.Equal(JsonValueKind.Null, next.GetProperty("total").ValueKind);
        Assert.DoesNotContain(commands.Sql, sql => sql.Contains("SELECT COUNT(*)", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(commands.Sql, sql => sql.Contains("FROM \"Sets\""));
        Assert.DoesNotContain(commands.Sql, sql => sql.Contains("FROM \"TrainingReadModels\""));
        var legacy = JsonSerializer.SerializeToElement(await HistoryReadService.Get(h.Db, finished, session.Id, 1, default));
        Assert.Equal(1, legacy.GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Activity_cache_reuses_completed_aggregation_but_tracks_active_edits_history_and_accounts()
    {
        var commands = new Commands();
        await using var h = await Harness.Create(observer: commands);
        var user = await h.SignIn();
        var service = h.Workouts;
        var now = DateTime.UtcNow;
        var finished = new WorkoutSession { UserId = user.Id, Name = "Completed", Active = false,
            StartedAt = now.AddHours(-2), FinishedAt = now.AddHours(-1) };
        var active = new WorkoutSession { UserId = user.Id, Name = "Live", Active = true, StartedAt = now };
        var exercise = new SessionExercise { UserId = user.Id, SessionId = finished.Id };
        h.Db.Workouts.AddRange(finished, active);
        h.Db.SessionExercises.Add(exercise);
        h.Db.Sets.Add(new CompletedSet { UserId = user.Id, SessionExerciseId = exercise.Id, Done = true, Reps = 8 });
        await h.Db.SaveChangesAsync();
        var from = DateOnly.FromDateTime(now).AddDays(-1);
        var to = from.AddDays(2);
        Assert.Equal(2, (await service.Activity(from, to, "UTC", default)).Count);
        commands.Sql.Clear();
        Assert.Equal(2, (await service.Activity(from, to, "UTC", default)).Count);
        Assert.DoesNotContain(commands.Sql, sql => sql.Contains("JOIN \"SessionExercises\""));
        active.Name = "Live edited";
        await h.Db.SaveChangesAsync();
        Assert.Contains(await service.Activity(from, to, "UTC", default), item => item.Name == "Live edited");
        finished.Name = "History edited";
        await h.Db.SaveChangesAsync();
        Assert.Contains(await service.Activity(from, to, "UTC", default), item => item.Name == "History edited");
        await h.SignIn("other");
        Assert.Empty(await service.Activity(from, to, "UTC", default));
    }

    [Fact]
    public async Task Catalog_lookup_skips_custom_table_for_seeds_and_preserves_archived_and_legacy_fallbacks()
    {
        var commands = new Commands();
        await using var h = await Harness.Create(observer: commands);
        var user = await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Bench Press", "Chest", "Barbell", null, LoadModel: LoadModels.External, TrackingMode: TrackingModes.Reps),
            new SeedExercise("legacy-press", "Legacy Press", "Shoulders", "Barbell", null, LoadModel: LoadModels.External, TrackingMode: TrackingModes.Reps));
        var benchId = await h.ExerciseId("bench");
        var legacyId = await h.ExerciseId("legacy-press");
        var legacyRow = await h.Db.Exercises.SingleAsync(x => x.Id == legacyId);
        legacyRow.Active = false;
        var customActive = new CustomExercise
        {
            UserId = user.Id, Name = "Cable Lateral Raise", Muscle = "Shoulders", Equipment = "Cable",
            LoadModel = LoadModels.External, LoadStepKg = 1.5, TrackingMode = TrackingModes.Duration, WeightBasis = WeightBases.PerSide
        };
        var customArchived = new CustomExercise
        {
            UserId = user.Id, Name = "Old Plank", Muscle = "Core", Equipment = "Bodyweight",
            LoadModel = LoadModels.RepsOnly, Archived = true, TrackingMode = TrackingModes.Duration, WeightBasis = WeightBases.Total
        };
        h.Db.CustomExercises.AddRange(customActive, customArchived);
        h.Db.MaintenanceAccess = true;
        try { await h.Db.SaveChangesAsync(); }
        finally { h.Db.MaintenanceAccess = false; }

        var catalog = new CatalogService(h.Db);
        var templates = new TemplateService(h.Db, catalog);
        commands.Sql.Clear();

        await catalog.RequireActive(benchId, default);
        await catalog.RequireAllActive([benchId], default);
        Assert.Equal(LoadModels.External, (await catalog.LoadModelsFor([benchId], default))[benchId]);
        Assert.Empty(await CatalogService.TrackingModesFor(h.Db, [benchId], default));
        Assert.Equal("Chest", (await catalog.MusclesFor([benchId], default))[benchId]);
        Assert.Equal("Chest", (await catalog.MuscleProfilesFor([benchId], default))[benchId].Primary);
        Assert.Equal(WeightBases.Total, (await ExerciseWeightBasis.Read(h.Db, [benchId], default))[benchId]);
        Assert.Equal("Bench Press", (await templates.CatalogNames([benchId], default))[benchId]);
        Assert.DoesNotContain(commands.Sql, sql => sql.Contains("FROM \"CustomExercises\""));

        var allIds = new Guid?[] { benchId, legacyId, customActive.Id, customArchived.Id };
        var models = await catalog.LoadModelsFor(allIds, default);
        Assert.Equal(LoadModels.RepsOnly, models[customArchived.Id]);
        Assert.Equal(LoadModels.External, models[legacyId]);
        var tracking = await CatalogService.TrackingModesFor(h.Db, allIds, default);
        Assert.Equal(new[] { customActive.Id, customArchived.Id }.OrderBy(x => x).ToList(), tracking.Keys.OrderBy(x => x).ToList());
        var muscles = await catalog.MusclesFor([legacyId, customActive.Id, customArchived.Id], default);
        Assert.Equal("Core", muscles[customArchived.Id]);
        Assert.Equal("Shoulders", muscles[legacyId]);
        var bases = await ExerciseWeightBasis.Read(h.Db, allIds, default);
        Assert.Equal(WeightBases.PerSide, bases[customActive.Id]);
        var names = await templates.CatalogNames(allIds, default);
        Assert.Equal("Old Plank (deleted)", names[customArchived.Id]);
        Assert.Equal("Legacy Press", names[legacyId]);

        await catalog.RequireAllActive([benchId, customActive.Id], default);
        await Assert.ThrowsAsync<DomainException>(() => catalog.RequireActive(legacyId, default));
        await Assert.ThrowsAsync<DomainException>(() => catalog.RequireActive(customArchived.Id, default));
    }
}
