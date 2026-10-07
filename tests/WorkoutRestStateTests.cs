using System.Text.Json;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class WorkoutRestStateTests
{
    private static async Task<(Harness h, Guid templateId, Guid benchId)> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null));
        var benchId = await h.ExerciseId("bench");
        var template = await h.Templates.Create(
            Harness.Template("Push", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10), Harness.Set(8, 10))), null, 1, 0, default);
        return (h, template.Id, benchId);
    }

    [Fact]
    public async Task Rest_mutation_lifecycle_start_extend_pause_resume_skip()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        Assert.NotNull(session.Rest);
        Assert.Equal("idle", session.Rest.Status);

        // Start
        var mutationId1 = Guid.NewGuid();
        var startResult = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: session.Revision,
            MutationId: mutationId1,
            Action: "start",
            Seconds: 90,
            Generation: "gen-1",
            OriginDeviceId: "phone-1"
        ), default);

        Assert.Equal(session.Revision + 1, startResult.Revision);
        Assert.NotNull(startResult.Rest);
        Assert.Equal("running", startResult.Rest.Status);
        Assert.Equal("gen-1", startResult.Rest.Generation);
        Assert.Equal("phone-1", startResult.Rest.OriginDeviceId);
        Assert.Equal(90_000L, startResult.Rest.DurationMs);
        Assert.NotNull(startResult.Rest.DeadlineUtc);
        var originalDeadline = startResult.Rest.DeadlineUtc.Value;

        // Idempotent replay preserves original deadline
        var replay = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: session.Revision,
            MutationId: mutationId1,
            Action: "start",
            Seconds: 90,
            Generation: "gen-1",
            OriginDeviceId: "phone-1"
        ), default);
        Assert.Equal(originalDeadline, replay.Rest!.DeadlineUtc);

        // Extend
        var mutationId2 = Guid.NewGuid();
        var extendResult = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: startResult.Revision,
            MutationId: mutationId2,
            Action: "extend",
            Seconds: 30,
            Generation: "gen-2"
        ), default);
        Assert.Equal("running", extendResult.Rest!.Status);
        Assert.Equal(120_000L, extendResult.Rest.DurationMs);
        Assert.True(extendResult.Rest.DeadlineUtc > originalDeadline);

        // Pause
        var mutationId3 = Guid.NewGuid();
        var pauseResult = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: extendResult.Revision,
            MutationId: mutationId3,
            Action: "pause"
        ), default);
        Assert.Equal("paused", pauseResult.Rest!.Status);
        Assert.Null(pauseResult.Rest.DeadlineUtc);
        Assert.True(pauseResult.Rest.PausedRemainingMs > 0);

        // Resume
        var mutationId4 = Guid.NewGuid();
        var resumeResult = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: pauseResult.Revision,
            MutationId: mutationId4,
            Action: "resume"
        ), default);
        Assert.Equal("running", resumeResult.Rest!.Status);
        Assert.NotNull(resumeResult.Rest.DeadlineUtc);
        Assert.Equal(0L, resumeResult.Rest.PausedRemainingMs);

        // Skip
        var mutationId5 = Guid.NewGuid();
        var skipResult = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: resumeResult.Revision,
            MutationId: mutationId5,
            Action: "skip"
        ), default);
        Assert.Equal("idle", skipResult.Rest!.Status);
        Assert.Null(skipResult.Rest.DeadlineUtc);
    }

    [Fact]
    public async Task Set_patch_commits_set_and_rest_together_in_single_revision()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var set = session.Exercises.Single().Sets.First();
        var mutationId = Guid.NewGuid();

        using var payload = JsonDocument.Parse($$"""
        {
            "revision": {{session.Revision}},
            "mutationId": "{{mutationId}}",
            "weightKg": 70,
            "reps": 10,
            "rpe": 8,
            "done": true,
            "rest": {
                "action": "start",
                "seconds": 90,
                "generation": "rest-gen-abc",
                "originDeviceId": "phone-alpha"
            }
        }
        """);

        var patched = await h.Workouts.PatchSet(session.Id, set.Id, payload.RootElement.Clone(), default);
        // Single atomic increment
        Assert.Equal(session.Revision + 1, patched.Revision);

        // Set is logged
        var changedSet = patched.Exercises.Single().Sets.Single(s => s.Id == set.Id);
        Assert.Equal(70, changedSet.WeightKg);
        Assert.Equal(10, changedSet.Reps);
        Assert.True(changedSet.Done);

        // Rest is running
        Assert.NotNull(patched.Rest);
        Assert.Equal("running", patched.Rest.Status);
        Assert.Equal("rest-gen-abc", patched.Rest.Generation);
        Assert.Equal("phone-alpha", patched.Rest.OriginDeviceId);
        Assert.NotNull(patched.Rest.DeadlineUtc);

        // Idempotent retry returns same state without double logging or resetting rest
        var replay = await h.Workouts.PatchSet(session.Id, set.Id, payload.RootElement.Clone(), default);
        Assert.Equal(patched.Revision, replay.Revision);
        Assert.Equal(patched.Rest.DeadlineUtc, replay.Rest!.DeadlineUtc);
    }

    [Fact]
    public async Task Workout_pause_and_resume_synchronizes_running_rest()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);

        // Start a rest
        var withRest = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: session.Revision,
            MutationId: Guid.NewGuid(),
            Action: "start",
            Seconds: 120
        ), default);
        Assert.Equal("running", withRest.Rest!.Status);

        // Pause the entire workout
        var pausedSession = await h.Workouts.Pause(session.Id, new WorkoutTimingInput(
            Revision: withRest.Revision,
            MutationId: Guid.NewGuid(),
            OccurredAt: DateTimeOffset.UtcNow
        ), default);

        Assert.NotNull(pausedSession.PausedAt);
        Assert.Equal("paused", pausedSession.Rest!.Status);
        Assert.True(pausedSession.Rest.PausedRemainingMs > 0);

        // Resume the workout
        var resumedSession = await h.Workouts.Resume(session.Id, new WorkoutTimingInput(
            Revision: pausedSession.Revision,
            MutationId: Guid.NewGuid(),
            OccurredAt: DateTimeOffset.UtcNow.AddSeconds(2)
        ), default);

        Assert.Null(resumedSession.PausedAt);
        Assert.Equal("running", resumedSession.Rest!.Status);
        Assert.NotNull(resumedSession.Rest.DeadlineUtc);
    }

    [Fact]
    public async Task Conflicting_rest_generation_requires_review()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);

        // Device A starts rest with gen-a
        var deviceA = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: session.Revision,
            MutationId: Guid.NewGuid(),
            Action: "start",
            Seconds: 60,
            Generation: "gen-a"
        ), default);

        // Device B tries to extend with an outdated baseline and wrong generation
        var conflict = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: session.Revision, // Stale revision
            MutationId: Guid.NewGuid(),
            Action: "extend",
            Seconds: 30,
            Generation: "gen-b",
            ExpectedGeneration: "gen-other" // The rest it last saw is not the current one
        ), default));

        Assert.Equal(409, conflict.Status);
    }

    [Fact]
    public async Task Replayed_start_keeps_the_deadline_from_when_the_set_was_logged()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var loggedAt = new DateTimeOffset(session.StartedAt, TimeSpan.Zero).AddMilliseconds(5);

        var started = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: session.Revision, MutationId: Guid.NewGuid(), Action: "start", Seconds: 90,
            Generation: "gen-late", OccurredAt: loggedAt), default);

        Assert.Equal(loggedAt.UtcDateTime.AddSeconds(90), started.Rest!.DeadlineUtc);
    }

    [Fact]
    public async Task Stale_rest_request_rebases_over_unrelated_edits()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var set = session.Exercises.Single().Sets.First();
        using var payload = JsonDocument.Parse($$"""{ "revision": {{session.Revision}}, "mutationId": "{{Guid.NewGuid()}}", "reps": 9 }""");
        var edited = await h.Workouts.PatchSet(session.Id, set.Id, payload.RootElement.Clone(), default);

        var started = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: session.Revision, MutationId: Guid.NewGuid(), Action: "start", Seconds: 60,
            Generation: "gen-new", ExpectedGeneration: null), default);

        Assert.Equal(edited.Revision + 1, started.Revision);
        Assert.Equal("gen-new", started.Rest!.Generation);
    }

    [Fact]
    public async Task Pausing_after_the_rest_ended_marks_it_elapsed()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var rest = await h.Workouts.MutateRest(session.Id, new WorkoutRestMutationInput(
            Revision: session.Revision, MutationId: Guid.NewGuid(), Action: "start", Seconds: 1,
            OccurredAt: new DateTimeOffset(session.StartedAt, TimeSpan.Zero)), default);
        await Task.Delay(1200);

        var paused = await h.Workouts.Pause(session.Id, new WorkoutTimingInput(
            Revision: rest.Revision, MutationId: Guid.NewGuid(), OccurredAt: DateTimeOffset.UtcNow), default);

        Assert.Equal("elapsed", paused.Rest!.Status);
        Assert.Equal(rest.Revision + 1, paused.Revision);
    }
}
