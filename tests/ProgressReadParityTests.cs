using System.Text.Json.Nodes;
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

    private static void SortExercises(JsonNode node)
    {
        var sorted = node["exercises"]!.AsArray().OrderBy(x => x!["exercise"]!.ToString()).Select(x => x!.DeepClone()).ToArray();
        node["exercises"] = new JsonArray(sorted);
    }
}
