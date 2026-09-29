using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Uploads are sent while their owner is active, so no scheduled job has to wake the API for them.
public sealed class GoogleHealthWorkoutFlushTests
{
    private static readonly Dictionary<string, string?> Settings = new() { ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret" };

    [Fact]
    public async Task ActiveUserFlushSendsOnlyThatUsersWork()
    {
        await using var harness = await Harness.Create(Settings);
        var (mine, other) = await SeedTwoUsersWithDueWork(harness);
        var service = Service(harness, OkResponses());

        var result = await service.ProcessDueAsync(default, mine.UserId, GoogleHealthWorkoutFlush.ActiveUserBudget);

        Assert.Equal(1, result.Succeeded);
        Assert.Equal("succeeded", (await Reload(harness, mine.Id)).ProcessingState);
        Assert.Equal("pending", (await Reload(harness, other.Id)).ProcessingState);
    }

    [Fact]
    public async Task ExhaustedBudgetLeavesWorkPendingForTheNextOpenOrDailySweep()
    {
        await using var harness = await Harness.Create(Settings);
        var (mine, _) = await SeedTwoUsersWithDueWork(harness);
        var service = Service(harness, OkResponses());

        var result = await service.ProcessDueAsync(default, mine.UserId, TimeSpan.Zero);

        Assert.Equal(0, result.Processed);
        Assert.Equal("pending", (await Reload(harness, mine.Id)).ProcessingState);
    }

    [Fact]
    public async Task ScheduledSweepStillDrainsEveryUser()
    {
        await using var harness = await Harness.Create(Settings);
        var (mine, other) = await SeedTwoUsersWithDueWork(harness);
        var service = Service(harness, OkResponses());

        var result = await service.ProcessDueAsync(default);

        Assert.Equal(2, result.Succeeded);
        Assert.Equal("succeeded", (await Reload(harness, mine.Id)).ProcessingState);
        Assert.Equal("succeeded", (await Reload(harness, other.Id)).ProcessingState);
    }

    [Fact]
    public async Task FlushFailureIsSwallowedAndLeavesTheUploadQueued()
    {
        await using var harness = await Harness.Create(Settings);
        var (mine, _) = await SeedTwoUsersWithDueWork(harness);
        var services = new ServiceCollection();
        services.AddSingleton(harness.Db);
        services.AddTransient(_ => Service(harness, _ => throw new HttpRequestException("google unavailable")));
        await using var provider = services.BuildServiceProvider();

        await GoogleHealthWorkoutFlush.ForActiveUserAsync(
            provider.GetRequiredService<IServiceScopeFactory>(), mine.UserId, NullLogger.Instance, default);

        Assert.Equal("pending", (await Reload(harness, mine.Id)).ProcessingState);
    }

    private static GoogleHealthWorkoutSyncService Service(Harness harness, Func<HttpRequestMessage, HttpResponseMessage> respond)
    {
        var http = new HttpClient(new Responder(respond));
        var google = new GoogleHealthService(http, harness.Db, new PlainKms(), harness.Config);
        return new GoogleHealthWorkoutSyncService(harness.Db, google, http, new GoogleHealthWorkoutSummaryService(harness.Db));
    }

    private static Func<HttpRequestMessage, HttpResponseMessage> OkResponses() => request => request.RequestUri!.Host == "oauth2.googleapis.com"
        ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"access_token\":\"token\"}") }
        : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"name\":\"users/me/dataTypes/exercise/dataPoints/1\"}") };

    private static async Task<(GoogleHealthWorkoutSyncWork Mine, GoogleHealthWorkoutSyncWork Other)> SeedTwoUsersWithDueWork(Harness harness)
    {
        var alice = await harness.SignIn("alice");
        var bob = await harness.CreateUser("bob", "subject-bob");
        var works = new List<GoogleHealthWorkoutSyncWork>();
        foreach (var user in new[] { alice, bob })
        {
            harness.Db.CurrentUser = user.Id; // writes are ownership-checked against the current user
            harness.Db.GoogleHealthConnections.Add(new GoogleHealthConnection
            {
                UserId = user.Id, GoogleIdHash = $"hash-{user.Id:N}", EncryptedRefreshToken = "refresh",
                GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWorkoutSyncService.WorkoutScope }),
                WorkoutSyncEnabled = true, Status = "connected"
            });
            var work = new GoogleHealthWorkoutSyncWork
            {
                UserId = user.Id, WorkoutSessionId = Guid.NewGuid(), GoogleIdHash = $"hash-{user.Id:N}", ConnectionGeneration = 1,
                DesiredStartedAt = DateTime.UtcNow.AddHours(-1), DesiredFinishedAt = DateTime.UtcNow,
                DesiredName = "Workout", ProcessingState = "pending", NextAttemptAt = DateTime.UtcNow.AddMinutes(-1)
            };
            harness.Db.GoogleHealthWorkoutSyncWork.Add(work);
            await harness.Db.SaveChangesAsync();
            works.Add(work);
        }
        harness.Db.CurrentUser = null;
        return (works[0], works[1]);
    }

    private static async Task<GoogleHealthWorkoutSyncWork> Reload(Harness harness, Guid id)
        => await harness.Db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == id);

    private sealed class Responder(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(respond(request));
    }

    private sealed class PlainKms : IIntegrationKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }
}
