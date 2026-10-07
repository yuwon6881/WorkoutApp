using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

[Collection("Performance")]
public sealed class ProgressReadParityTests
{
    [Fact]
    public async Task Bounded_rebuild_matches_original_across_batches_and_load_models()
    {
        await using var h = await Harness.Create(); await h.SignIn();
        for (var i = 0; i < 140; i++)
        {
            var finished = DateTime.UtcNow.Date.AddDays(-i);
            var session = new WorkoutSession { UserId = h.Db.CurrentUser!.Value, Active = false,
                Name = "Fixture", StartedAt = finished.AddMinutes(-25), FinishedAt = finished, PausedSeconds = i % 60,
                BodyWeightSnapshotJson = Json.Write(new BodyWeightSnapshot(80, null, null, null, 80, "scale", null, "test", null, finished)) };
            h.Db.Workouts.Add(session);
            foreach (var model in new[] { LoadModels.External, LoadModels.FullBodyweight, LoadModels.BodyweightContextOnly })
            {
                var exercise = new SessionExercise { UserId = session.UserId, SessionId = session.Id, NameSnapshot = model,
                    LoadModel = model };
                h.Db.SessionExercises.Add(exercise);
                h.Db.Sets.Add(new CompletedSet { UserId = session.UserId, SessionExerciseId = exercise.Id, Done = true,
                    Reps = i % 15 + 1, Rpe = i % 8 == 0 ? null : 8,
                    WeightKg = i % 7 == 0 ? null : i % 5 == 0 ? 0 : i % 30,
                    SystemLoadKg = model == LoadModels.FullBodyweight && i % 7 != 0 ? 80 + i % 30 : null,
                    ResistanceMode = i % 2 == 0 ? ResistanceModes.Added : ResistanceModes.Assistance });
            }
        }
        await h.Db.SaveChangesAsync();
        var expected = JsonNode.Parse(Json.Write(await ProgressReference.Build(h.Db, default)))!;
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var actual = JsonNode.Parse(Json.Write(await ProgressReadService.Get(h.Db, cache, default)))!;
        SortExercises(expected); SortExercises(actual);
        Assert.True(JsonNode.DeepEquals(expected, actual), $"Expected {expected}\nActual {actual}");
    }

    [Fact]
    public async Task A_new_day_recounts_only_the_last_week_and_keeps_the_lifetime_figures()
    {
        await using var h = await Harness.Create(); await h.SignIn();
        for (var i = 0; i < 12; i++)
        {
            var finished = DateTime.UtcNow.Date.AddDays(-i).AddHours(1);
            var session = new WorkoutSession { UserId = h.Db.CurrentUser!.Value, Active = false,
                Name = "Fixture", StartedAt = finished.AddMinutes(-30), FinishedAt = finished };
            var exercise = new SessionExercise { UserId = session.UserId, SessionId = session.Id, NameSnapshot = "Bench" };
            h.Db.Workouts.Add(session); h.Db.SessionExercises.Add(exercise);
            h.Db.Sets.Add(new CompletedSet { UserId = session.UserId, SessionExerciseId = exercise.Id, Done = true, Reps = 8, WeightKg = 50 + i });
        }
        await h.Db.SaveChangesAsync();
        using (var first = new MemoryCache(new MemoryCacheOptions())) await ProgressReadService.Get(h.Db, first, default);

        // Yesterday's snapshot of the same history. The lifetime marker shows whether it was reused.
        var row = h.Db.TrainingReadModels.Single(x => x.Kind == "progress");
        var stored = JsonNode.Parse(row.Json)!;
        stored["date"] = DateTime.UtcNow.AddDays(-1).ToString("yyyy-MM-dd");
        stored["value"]!["sessions"] = 999;
        stored["value"]!["weekSessions"] = 0;
        stored["value"]!["weekWorkingSets"] = 0;
        stored["value"]!["weekVolumeKg"] = null;
        row.Json = stored.ToJsonString();
        await h.Db.SaveChangesAsync();
        h.Db.ChangeTracker.Clear();

        using var cache = new MemoryCache(new MemoryCacheOptions());
        var actual = JsonNode.Parse(Json.Write(await ProgressReadService.Get(h.Db, cache, default)))!;
        var expected = JsonNode.Parse(Json.Write(await ProgressReference.Build(h.Db, default)))!;

        Assert.Equal(999, actual["sessions"]!.GetValue<int>());
        foreach (var field in new[] { "weekSessions", "weekWorkingSets", "weekVolumeKg" })
            Assert.True(JsonNode.DeepEquals(expected[field], actual[field]), $"{field}: expected {expected[field]}, got {actual[field]}");
        Assert.Equal(7, actual["weekSessions"]!.GetValue<int>());
        Assert.Equal(DateTime.UtcNow.ToString("yyyy-MM-dd"),
            JsonNode.Parse(h.Db.TrainingReadModels.AsNoTracking().Single(x => x.Kind == "progress").Json)!["date"]!.GetValue<string>());
    }

    private static void SortExercises(JsonNode node)
    {
        var sorted = node["exercises"]!.AsArray().OrderBy(x => x!["exercise"]!.ToString()).Select(x => x!.DeepClone()).ToArray();
        node["exercises"] = new JsonArray(sorted);
    }
}
