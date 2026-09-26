using System.Text.Json;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class WatchWorkoutAccessTests
{
    [Fact]
    public async Task A_watch_reads_only_the_live_workout_and_never_finished_history()
    {
        var harness = await Ready();
        await using var _ = harness;
        var session = await harness.Workouts.Start(await CreateTemplate(harness), null, default);

        var live = await WatchWorkoutAccess.ActiveSession(harness.Workouts, session.Id, default);
        Assert.Equal(session.Id, live.Id);

        var set = session.Exercises.Single().Sets[0];
        using var log = JsonDocument.Parse($$"""
            {"revision":{{session.Revision}},"mutationId":"{{Guid.NewGuid()}}","weightKg":60,"reps":8,"done":true}
            """);
        var logged = await harness.Workouts.PatchSet(session.Id, set.Id, log.RootElement.Clone(), default);
        await harness.Workouts.Finish(session.Id, logged.Revision, default);

        var finished = await Assert.ThrowsAsync<DomainException>(() => WatchWorkoutAccess.ActiveSession(harness.Workouts, session.Id, default));
        Assert.Equal(404, finished.Status);
        var unknown = await Assert.ThrowsAsync<DomainException>(() => WatchWorkoutAccess.ActiveSession(harness.Workouts, Guid.NewGuid(), default));
        Assert.Equal(404, unknown.Status);
    }

    [Fact]
    public async Task A_watch_set_patch_logs_values_but_cannot_change_the_set_shape()
    {
        var harness = await Ready();
        await using var _ = harness;
        var session = await harness.Workouts.Start(await CreateTemplate(harness), null, default);
        var set = session.Exercises.Single().Sets[0];
        using var payload = JsonDocument.Parse($$"""
            {"revision":{{session.Revision}},"mutationId":"{{Guid.NewGuid()}}","weightKg":62.5,"reps":7,"rpe":8,"rir":"2",
             "done":true,"warmup":true,"resistanceMode":"assistance"}
            """);

        var filtered = WatchWorkoutAccess.SetPatch(payload.RootElement);
        Assert.False(filtered.TryGetProperty("warmup", out JsonElement _));
        Assert.False(filtered.TryGetProperty("resistanceMode", out JsonElement _));

        var saved = (await harness.Workouts.PatchSet(session.Id, set.Id, filtered, default))
            .Exercises.Single().Sets.Single(row => row.Id == set.Id);
        Assert.True(saved.Done);
        Assert.Equal(7, saved.Reps);
        Assert.Equal(62.5, saved.WeightKg);
        Assert.Equal("2", saved.Rir);
        Assert.Equal(set.Warmup, saved.Warmup);
        Assert.Equal(set.ResistanceMode, saved.ResistanceMode);
    }

    private static async Task<Harness> Ready()
    {
        var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        return harness;
    }

    private static async Task<Guid> CreateTemplate(Harness harness)
    {
        var exerciseId = await harness.ExerciseId("bench");
        var template = await harness.Templates.Create(
            Harness.Template("Watch access", Harness.Exercise(exerciseId, "Bench press", Harness.Set(8, 10), Harness.Set(8, 10))),
            null, 1, 0, default);
        return template.Id;
    }
}
