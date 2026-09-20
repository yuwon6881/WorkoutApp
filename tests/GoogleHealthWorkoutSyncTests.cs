using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class GoogleHealthWorkoutSyncTests
{
    [Fact]
    public void BuildDataPointProducesValidIntervalAndActivityType()
    {
        var start = new DateTime(2026, 9, 20, 1, 0, 0, DateTimeKind.Utc);
        var finish = new DateTime(2026, 9, 20, 2, 15, 0, DateTimeKind.Utc);

        var dp = GoogleHealthWorkoutSyncService.BuildDataPoint(
            start,
            finish,
            "Heavy Leg Day",
            "Squats: 3 sets\nTotal Volume: 4,000 kg",
            "Asia/Kuala_Lumpur");

        Assert.Equal("2026-09-20T09:00:00+08:00", dp.StartTime);
        Assert.Equal("2026-09-20T10:15:00+08:00", dp.EndTime);
        Assert.Equal("Heavy Leg Day", dp.ExerciseDisplayName);
        Assert.Equal("WEIGHTLIFTING", dp.ActivityType);
        Assert.Contains("Total Volume: 4,000 kg", dp.Notes);
    }

    [Fact]
    public async Task WorkoutFinishingQueuesGoogleHealthWorkoutSyncWhenEnabled()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();

        harness.Db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = user.Id,
            GoogleIdHash = "gh-hash-test",
            EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWorkoutSyncService.WorkoutScope }),
            WorkoutSyncEnabled = true,
            Status = "connected"
        });
        await harness.Db.SaveChangesAsync();

        var google = new GoogleHealthService(new HttpClient(), harness.Db, new TestKms(), new ConfigurationBuilder().Build());
        var workoutSync = new GoogleHealthWorkoutSyncService(harness.Db, google, new HttpClient());
        var workouts = new WorkoutService(
            harness.Db,
            harness.Catalog,
            harness.Templates,
            harness.Progression,
            new NutritionContextService(harness.Db, new MockHttpClientFactory(), harness.Config),
            harness.Programs,
            workoutSync);

        await harness.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        var benchId = await harness.ExerciseId("bench");
        var template = await harness.Templates.Create(
            Harness.Template("Chest Day", Harness.Exercise(benchId, "Bench press", Harness.Set(10, 80))), null, 1, 0, default);

        var session = await workouts.Start(template.Id, null, default);
        var set = session.Exercises.Single().Sets.First();
        using var payload = JsonDocument.Parse($"{{\"revision\":{session.Revision},\"weightKg\":80,\"reps\":10,\"done\":true,\"mutationId\":\"{Guid.NewGuid()}\"}}");
        await workouts.PatchSet(session.Id, set.Id, payload.RootElement.Clone(), default);

        var finished = await workouts.Finish(session.Id, session.Revision + 1, default);
        Assert.False(finished.Active);

        var work = await harness.Db.GoogleHealthWorkoutSyncWork.SingleOrDefaultAsync(x => x.WorkoutSessionId == session.Id);
        Assert.NotNull(work);
        Assert.Equal("pending", work!.ProcessingState);
        Assert.False(work.DesiredDeleted);
        Assert.Equal("Chest Day", work.DesiredName);
        Assert.Contains("Total Volume: 800 kg", work.DesiredNotes);

        // Deleting from history queues deletion
        await workouts.DeleteFromHistory(session.Id, default);
        var deletedWork = await harness.Db.GoogleHealthWorkoutSyncWork.SingleOrDefaultAsync(x => x.WorkoutSessionId == session.Id);
        Assert.NotNull(deletedWork);
        Assert.True(deletedWork!.DesiredDeleted);
        Assert.Equal("pending", deletedWork.ProcessingState);
    }

    private sealed class TestKms : IIntegrationKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }

    private sealed class MockHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }
}
