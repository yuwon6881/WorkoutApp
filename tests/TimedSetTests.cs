using System.Text.Json;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class TimedSetTests
{
    [Fact]
    public async Task Timed_exercise_starts_without_rep_prefill_or_rep_suggestion()
    {
        var harness = await Ready();
        await using var _ = harness;
        var session = await harness.Workouts.Start(await CreateTemplate(harness), null, default);

        var exercise = Assert.Single(session.Exercises);
        Assert.Equal(TrackingModes.Duration, exercise.TrackingMode);
        Assert.All(exercise.Sets, set =>
        {
            Assert.Null(set.Reps);
            Assert.Null(set.DurationSeconds);
            Assert.Null(set.Suggestion);
        });
        Assert.Null(exercise.Progression);
    }

    [Fact]
    public async Task Watch_logs_a_timed_set_with_seconds_and_no_reps()
    {
        var harness = await Ready();
        await using var _ = harness;
        var session = await harness.Workouts.Start(await CreateTemplate(harness), null, default);
        var set = session.Exercises.Single().Sets[0];

        using var patch = JsonDocument.Parse($$"""
            {"revision":{{session.Revision}},"mutationId":"{{Guid.NewGuid()}}","durationSeconds":45,"done":true}
            """);
        var saved = await harness.Workouts.PatchSet(session.Id, set.Id, WatchWorkoutAccess.SetPatch(patch.RootElement.Clone()), default);

        var logged = saved.Exercises.Single().Sets.Single(row => row.Id == set.Id);
        Assert.True(logged.Done);
        Assert.Equal(45, logged.DurationSeconds);
        Assert.Null(logged.Reps);
    }

    [Theory]
    [InlineData("\"done\":true")]
    [InlineData("\"durationSeconds\":0")]
    [InlineData("\"durationSeconds\":7201")]
    public async Task Set_patch_rejects_a_completed_set_without_reps_or_time_and_out_of_range_time(string fields)
    {
        var harness = await Ready();
        await using var _ = harness;
        var session = await harness.Workouts.Start(await CreateTemplate(harness), null, default);
        var set = session.Exercises.Single().Sets[0];

        using var patch = JsonDocument.Parse($$"""
            {"revision":{{session.Revision}},"mutationId":"{{Guid.NewGuid()}}",{{fields}}}
            """);
        var failure = await Assert.ThrowsAsync<DomainException>(() => harness.Workouts.PatchSet(session.Id, set.Id, patch.RootElement.Clone(), default));
        Assert.Equal(400, failure.Status);
    }

    [Fact]
    public async Task Weighted_timed_sets_finish_without_volume_or_strength_records()
    {
        var harness = await Ready();
        await using var _ = harness;
        var session = await harness.Workouts.Start(await CreateTemplate(harness), null, default);
        foreach (var set in session.Exercises.Single().Sets)
        {
            var current = await harness.Workouts.Get(session.Id, default);
            using var patch = JsonDocument.Parse($$"""
                {"revision":{{current.Revision}},"mutationId":"{{Guid.NewGuid()}}","weightKg":20,"durationSeconds":60,"done":true}
                """);
            await harness.Workouts.PatchSet(session.Id, set.Id, patch.RootElement.Clone(), default);
        }

        var latest = await harness.Workouts.Get(session.Id, default);
        var finished = await harness.Workouts.Finish(session.Id, latest.Revision, default);

        Assert.Null(finished.VolumeKg);
        var exercise = finished.Exercises.Single();
        Assert.False(exercise.IsPr);
        Assert.All(exercise.Sets, set => Assert.Equal(60, set.DurationSeconds));
    }

    private static async Task<Harness> Ready()
    {
        var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(new SeedExercise("plank", "Plank", "Abs", "Bodyweight", null, TrackingMode: TrackingModes.Duration));
        return harness;
    }

    private static async Task<Guid> CreateTemplate(Harness harness)
    {
        var exerciseId = await harness.ExerciseId("plank");
        var template = await harness.Templates.Create(
            Harness.Template("Core", Harness.Exercise(exerciseId, "Plank", Harness.Set(8, 10), Harness.Set(8, 10))),
            null, 1, 0, default);
        return template.Id;
    }
}
