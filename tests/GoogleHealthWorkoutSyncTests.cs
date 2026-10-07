using System.Text.Json;
using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class GoogleHealthWorkoutSyncTests
{
    [Fact]
    public async Task Clearing_exercise_history_queues_updated_notes_for_the_finished_workout()
    {
        await using var h = await Harness.Create(new() { ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret" });
        var user = await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null));
        var exerciseId = await h.ExerciseId("bench");
        var template = await h.Templates.Create(Harness.Template("Push", Harness.Exercise(exerciseId, "Bench", Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var exercise = session.Exercises[0];
        var saved = await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exerciseId, "Bench", null, exercise.Prescription,
                [new SetInput(60, 8, 8, true, Id: exercise.Sets[0].Id)], Id: exercise.Id)], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, saved.Revision, default);
        h.Db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = user.Id, GoogleIdHash = "hash", EncryptedRefreshToken = "refresh", WorkoutSyncEnabled = true,
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWorkoutSyncService.WorkoutScope }), Status = "connected"
        });
        await h.Db.SaveChangesAsync();
        using var http = new HttpClient(new RespondingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)));
        var google = new GoogleHealthService(http, h.Db, new TestKms(), h.Config);
        var sync = new GoogleHealthWorkoutSyncService(h.Db, google, http, new GoogleHealthWorkoutSummaryService(h.Db));
        await sync.QueueWorkoutAsync(session.Id, false, default);
        await h.Db.SaveChangesAsync();
        var work = await h.Db.GoogleHealthWorkoutSyncWork.SingleAsync();
        var notes = work.DesiredNotes;
        var revision = work.DesiredRevision;
        await new ExerciseService(h.Db, workoutSync: sync).ClearHistory(exerciseId, default);
        Assert.Equal(revision + 1, work.DesiredRevision);
        Assert.NotEqual(notes, work.DesiredNotes);
        Assert.False(work.DesiredDeleted);
    }

    [Fact]
    public async Task DueWorkUsesItsOwnerWhenBackgroundContextHasNoCurrentUser()
    {
        await using var harness = await Harness.Create(new() { ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret" });
        var user = await harness.SignIn();
        harness.Db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = user.Id, GoogleIdHash = "hash", EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWorkoutSyncService.WorkoutScope }),
            WorkoutSyncEnabled = true, Status = "connected"
        });
        var work = new GoogleHealthWorkoutSyncWork
        {
            UserId = user.Id, WorkoutSessionId = Guid.NewGuid(), GoogleIdHash = "hash", ConnectionGeneration = 1,
            DesiredStartedAt = DateTime.UtcNow.AddHours(-1), DesiredFinishedAt = DateTime.UtcNow,
            DesiredName = "Workout", ProcessingState = "pending", NextAttemptAt = DateTime.UtcNow.AddMinutes(-1)
        };
        harness.Db.GoogleHealthWorkoutSyncWork.Add(work);
        await harness.Db.SaveChangesAsync();
        harness.Db.CurrentUser = null;

        var handler = new RespondingHandler(request => request.RequestUri!.Host == "oauth2.googleapis.com"
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"access_token\":\"token\"}") }
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"name\":\"users/me/dataTypes/exercise/dataPoints/1\"}") });
        var http = new HttpClient(handler);
        var google = new GoogleHealthService(http, harness.Db, new TestKms(), harness.Config);
        var service = new GoogleHealthWorkoutSyncService(harness.Db, google, http, new GoogleHealthWorkoutSummaryService(harness.Db));

        var result = await service.ProcessDueAsync(default);

        Assert.Equal(1, result.Succeeded);
        Assert.Equal("succeeded", work.ProcessingState);
        Assert.Null(harness.Db.CurrentUser);
    }

    [Fact]
    public async Task TokenFetchExceptionReleasesLeaseForRetry()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        harness.Db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = user.Id, GoogleIdHash = "hash", EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWorkoutSyncService.WorkoutScope }),
            WorkoutSyncEnabled = true, Status = "connected"
        });
        var work = new GoogleHealthWorkoutSyncWork
        {
            UserId = user.Id, WorkoutSessionId = Guid.NewGuid(), GoogleIdHash = "hash", ConnectionGeneration = 1,
            DesiredStartedAt = DateTime.UtcNow.AddHours(-1), DesiredFinishedAt = DateTime.UtcNow,
            DesiredName = "Workout", ProcessingState = "pending", NextAttemptAt = DateTime.UtcNow.AddMinutes(-1)
        };
        harness.Db.GoogleHealthWorkoutSyncWork.Add(work);
        await harness.Db.SaveChangesAsync();
        harness.Db.CurrentUser = null;
        var http = new HttpClient();
        var google = new GoogleHealthService(http, harness.Db, new ThrowingKms(), harness.Config);
        var service = new GoogleHealthWorkoutSyncService(harness.Db, google, http, new GoogleHealthWorkoutSummaryService(harness.Db));

        var result = await service.ProcessDueAsync(default);

        Assert.Equal(1, result.Retried);
        Assert.Equal("pending", work.ProcessingState);
        Assert.Null(work.LeaseUntil);
    }

    [Fact]
    public async Task InvalidClientDoesNotRequireEveryUserToReconnect()
    {
        await using var harness = await Harness.Create(new() { ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "rotated" });
        var user = await harness.SignIn();
        var connection = new GoogleHealthConnection
        {
            UserId = user.Id, GoogleIdHash = "hash", EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWorkoutSyncService.WorkoutScope }),
            WorkoutSyncEnabled = true, Status = "connected"
        };
        harness.Db.GoogleHealthConnections.Add(connection);
        await harness.Db.SaveChangesAsync();
        var http = new HttpClient(new RespondingHandler(_ => new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("{\"error\":\"invalid_client\"}")
        }));
        var google = new GoogleHealthService(http, harness.Db, new TestKms(), harness.Config);

        await Assert.ThrowsAsync<HttpRequestException>(() => google.GetAccessTokenAsync(user.Id, GoogleHealthWorkoutSyncService.WorkoutScope, default));

        Assert.Equal("connected", connection.Status);
    }

    [Fact]
    public async Task UploadUnauthorizedMarksConnectionForReconnect()
    {
        await using var harness = await Harness.Create(new() { ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret" });
        var user = await harness.SignIn();
        var connection = new GoogleHealthConnection
        {
            UserId = user.Id, GoogleIdHash = "hash", EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWorkoutSyncService.WorkoutScope }),
            WorkoutSyncEnabled = true, Status = "connected"
        };
        harness.Db.GoogleHealthConnections.Add(connection);
        var work = new GoogleHealthWorkoutSyncWork
        {
            UserId = user.Id, WorkoutSessionId = Guid.NewGuid(), GoogleIdHash = "hash", ConnectionGeneration = 1,
            DesiredStartedAt = DateTime.UtcNow.AddHours(-1), DesiredFinishedAt = DateTime.UtcNow,
            DesiredName = "Workout", ProcessingState = "pending", NextAttemptAt = DateTime.UtcNow.AddMinutes(-1)
        };
        harness.Db.GoogleHealthWorkoutSyncWork.Add(work);
        await harness.Db.SaveChangesAsync();
        harness.Db.CurrentUser = null;
        var http = new HttpClient(new RespondingHandler(request => request.RequestUri!.Host == "oauth2.googleapis.com"
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"access_token\":\"token\"}") }
            : new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("{}") }));
        var google = new GoogleHealthService(http, harness.Db, new TestKms(), harness.Config);
        var service = new GoogleHealthWorkoutSyncService(harness.Db, google, http, new GoogleHealthWorkoutSummaryService(harness.Db));

        var result = await service.ProcessDueAsync(default);

        Assert.Equal(1, result.Failed);
        Assert.Equal("reconnect_required", connection.Status);
        Assert.Equal("failed", work.ProcessingState);
    }

    [Fact]
    public async Task ExpiredCreateLeaseBecomesUnknownInsteadOfCreatingAnotherCopy()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        var work = new GoogleHealthWorkoutSyncWork
        {
            UserId = user.Id, WorkoutSessionId = Guid.NewGuid(), GoogleIdHash = "hash", ConnectionGeneration = 1,
            DesiredName = "Workout", ProcessingState = "processing", LeaseId = "old",
            LeaseUntil = DateTime.UtcNow.AddMinutes(-1), NextAttemptAt = DateTime.UtcNow.AddMinutes(-2)
        };
        harness.Db.GoogleHealthWorkoutSyncWork.Add(work);
        await harness.Db.SaveChangesAsync();
        harness.Db.CurrentUser = null;
        var http = new HttpClient();
        var google = new GoogleHealthService(http, harness.Db, new TestKms(), harness.Config);
        var service = new GoogleHealthWorkoutSyncService(harness.Db, google, http, new GoogleHealthWorkoutSummaryService(harness.Db));

        await service.ProcessDueAsync(default);

        Assert.Equal("unknown", work.ProcessingState);
        Assert.Equal("upload_status_unknown", work.LastErrorCategory);
    }

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
        var workoutSummary = new GoogleHealthWorkoutSummaryService(harness.Db);
        var workoutSync = new GoogleHealthWorkoutSyncService(harness.Db, google, new HttpClient(), workoutSummary);
        var workouts = new WorkoutService(
            harness.Db,
            harness.Catalog,
            harness.Templates,
            harness.Progression,
            new NutritionContextService(harness.Db, new MockHttpClientFactory(), harness.Config),
            harness.Programs,
            workoutSync);

        await harness.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null));
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
        Assert.Equal("cancelled", deletedWork.ProcessingState);
    }

    [Fact]
    public async Task OneOwnersFailedWriteDoesNotStopOrBlameTheNextOwnersUpload()
    {
        var failures = new FailingCommands();
        await using var harness = await Harness.Create(new() { ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret" }, failures);
        var alice = await harness.SignIn("alice");
        var aliceWork = await QueueUpload(harness, alice.Id, DateTime.UtcNow.AddMinutes(-2));
        var bob = await harness.SignIn("bob");
        var bobWork = await QueueUpload(harness, bob.Id, DateTime.UtcNow.AddMinutes(-1));
        harness.Db.CurrentUser = null;

        // Alice's lease is written, then every later write of her work fails, including the retry
        // the catch handler attempts, so her item ends with tracked edits that were never saved.
        var aliceUpdates = 0;
        failures.Fails = command => command.CommandText.StartsWith("UPDATE \"GoogleHealthWorkoutSyncWork\"", StringComparison.Ordinal)
            && FailingCommands.Mentions(command, aliceWork.Id) && ++aliceUpdates > 1;
        var http = new HttpClient(new RespondingHandler(request => request.RequestUri!.Host == "oauth2.googleapis.com"
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"access_token\":\"token\"}") }
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"name\":\"users/me/dataTypes/exercise/dataPoints/1\"}") }));
        var google = new GoogleHealthService(http, harness.Db, new TestKms(), harness.Config);
        var service = new GoogleHealthWorkoutSyncService(harness.Db, google, http, new GoogleHealthWorkoutSummaryService(harness.Db));

        var result = await service.ProcessDueAsync(default);

        Assert.Equal(2, result.Processed);
        Assert.Equal(1, result.Succeeded);
        failures.Fails = _ => false;
        var stored = await harness.Db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters().AsNoTracking()
            .ToDictionaryAsync(work => work.Id, work => work.ProcessingState);
        Assert.Equal("succeeded", stored[bobWork.Id]);
        Assert.Equal("processing", stored[aliceWork.Id]);
        Assert.Null(harness.Db.CurrentUser);
    }

    private static async Task<GoogleHealthWorkoutSyncWork> QueueUpload(Harness harness, Guid userId, DateTime due)
    {
        harness.Db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = userId, GoogleIdHash = $"hash-{userId:N}", EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWorkoutSyncService.WorkoutScope }),
            WorkoutSyncEnabled = true, Status = "connected"
        });
        var work = new GoogleHealthWorkoutSyncWork
        {
            UserId = userId, WorkoutSessionId = Guid.NewGuid(), GoogleIdHash = $"hash-{userId:N}", ConnectionGeneration = 1,
            DesiredStartedAt = DateTime.UtcNow.AddHours(-1), DesiredFinishedAt = DateTime.UtcNow,
            DesiredName = "Workout", ProcessingState = "pending", NextAttemptAt = due
        };
        harness.Db.GoogleHealthWorkoutSyncWork.Add(work);
        await harness.Db.SaveChangesAsync();
        return work;
    }

    private sealed class TestKms : IIntegrationKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }

    private sealed class ThrowingKms : IIntegrationKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => throw new InvalidOperationException("kms unavailable");
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => throw new InvalidOperationException("kms unavailable");
    }

    private sealed class RespondingHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(respond(request));
    }

    private sealed class MockHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }
}
