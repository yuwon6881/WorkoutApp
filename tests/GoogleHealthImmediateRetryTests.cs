using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A brief Google or network hiccup is retried at once; anything that could duplicate data or that the
/// provider asked us to wait out is left to the queue.
public sealed class GoogleHealthImmediateRetryTests
{
    private static readonly GoogleHealthOperationResult Done = new(true, true, ResourceName: "users/me/dataPoints/1");
    private static Task NoWait(TimeSpan pause, CancellationToken ct) => Task.CompletedTask;

    [Fact]
    public async Task A_transient_failure_is_retried_after_a_short_pause_and_then_succeeds()
    {
        var pauses = new List<TimeSpan>();
        var calls = 0;

        var result = await GoogleHealthImmediateRetry.RunAsync(
            () => ++calls == 1
                ? throw new GoogleHealthWorkoutProviderException("provider_unavailable", "503", transient: true)
                : Task.FromResult(Done),
            default,
            (pause, _) => { pauses.Add(pause); return Task.CompletedTask; });

        Assert.Same(Done, result);
        Assert.Equal(2, calls);
        Assert.Equal([TimeSpan.FromMilliseconds(500)], pauses);
    }

    [Fact]
    public async Task A_persistent_transient_failure_stops_after_two_retries_and_surfaces_the_original_error()
    {
        var calls = 0;
        var failure = new GoogleHealthWorkoutProviderException("provider_unavailable", "503", transient: true);

        var thrown = await Assert.ThrowsAsync<GoogleHealthWorkoutProviderException>(
            () => GoogleHealthImmediateRetry.RunAsync(() => { calls++; throw failure; }, default, NoWait));

        Assert.Same(failure, thrown);
        Assert.Equal(3, calls);
    }

    [Fact]
    public async Task An_unknown_create_is_never_retried_because_a_duplicate_may_exist()
    {
        var calls = 0;

        await Assert.ThrowsAsync<GoogleHealthWorkoutProviderException>(() => GoogleHealthImmediateRetry.RunAsync(
            () => { calls++; throw new GoogleHealthWorkoutProviderException("upload_status_unknown", "lost", unknownCreate: true, transient: true); },
            default,
            NoWait));

        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Authentication_and_permanent_failures_are_not_retried()
    {
        var calls = 0;
        await Assert.ThrowsAsync<GoogleHealthWorkoutProviderException>(() => GoogleHealthImmediateRetry.RunAsync(
            () => { calls++; throw new GoogleHealthWorkoutProviderException("auth", "401", transient: true, authenticationFailure: true); },
            default,
            NoWait));
        await Assert.ThrowsAsync<GoogleHealthWorkoutProviderException>(() => GoogleHealthImmediateRetry.RunAsync(
            () => { calls++; throw new GoogleHealthWorkoutProviderException("invalid", "400"); },
            default,
            NoWait));

        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task A_short_retry_after_replaces_the_default_pause_and_a_long_one_is_left_to_the_queue()
    {
        var pauses = new List<TimeSpan>();
        var calls = 0;
        await GoogleHealthImmediateRetry.RunAsync(
            () => ++calls == 1
                ? throw new GoogleHealthWorkoutProviderException("rate", "429", transient: true, retryAfter: TimeSpan.FromSeconds(1))
                : Task.FromResult(Done),
            default,
            (pause, _) => { pauses.Add(pause); return Task.CompletedTask; });
        Assert.Equal([TimeSpan.FromSeconds(1)], pauses);

        var longCalls = 0;
        await Assert.ThrowsAsync<GoogleHealthWorkoutProviderException>(() => GoogleHealthImmediateRetry.RunAsync(
            () => { longCalls++; throw new GoogleHealthWorkoutProviderException("rate", "429", transient: true, retryAfter: TimeSpan.FromSeconds(30)); },
            default,
            NoWait));
        Assert.Equal(1, longCalls);
    }

    [Fact]
    public async Task Cancellation_is_never_swallowed_or_retried()
    {
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        var calls = 0;

        await Assert.ThrowsAsync<OperationCanceledException>(() => GoogleHealthImmediateRetry.RunAsync(
            () => { calls++; throw new OperationCanceledException(cancelled.Token); },
            cancelled.Token,
            NoWait));

        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task A_workout_upload_that_gets_a_503_then_succeeds_completes_in_one_pass()
    {
        await using var harness = await Harness.Create(new() { ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret" });
        var work = await SeedDueUpload(harness);
        var providerCalls = 0;
        var service = Service(harness, request => request.RequestUri!.Host == "health.googleapis.com" && providerCalls++ == 0
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            : Ok(request));

        var result = await service.ProcessDueAsync(default);

        Assert.Equal(1, result.Succeeded);
        Assert.Equal(2, providerCalls);
        Assert.Equal("succeeded", (await Reload(harness, work)).ProcessingState);
    }

    [Fact]
    public async Task A_workout_upload_that_keeps_failing_waits_for_the_queues_backoff_after_three_attempts()
    {
        await using var harness = await Harness.Create(new() { ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret" });
        var work = await SeedDueUpload(harness);
        var providerCalls = 0;
        var service = Service(harness, request => request.RequestUri!.Host == "health.googleapis.com" && ++providerCalls > 0
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            : Ok(request));

        var result = await service.ProcessDueAsync(default);

        Assert.Equal(1, result.Retried);
        Assert.Equal(3, providerCalls);
        Assert.Equal("pending", (await Reload(harness, work)).ProcessingState);
    }

    [Fact]
    public async Task A_lost_workout_create_response_is_never_resent()
    {
        await using var harness = await Harness.Create(new() { ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret" });
        var work = await SeedDueUpload(harness);
        var providerCalls = 0;
        var service = Service(harness, request => request.RequestUri!.Host == "health.googleapis.com" && ++providerCalls > 0
            ? throw new HttpRequestException("connection reset after send")
            : Ok(request));

        var result = await service.ProcessDueAsync(default);

        Assert.Equal(1, result.Unknown);
        Assert.Equal(1, providerCalls);
        Assert.Equal("unknown", (await Reload(harness, work)).ProcessingState);
    }

    private static HttpResponseMessage Ok(HttpRequestMessage request) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(request.RequestUri!.Host == "oauth2.googleapis.com"
            ? "{\"access_token\":\"token\"}"
            : "{\"name\":\"users/me/dataTypes/exercise/dataPoints/1\"}")
    };

    private static GoogleHealthWorkoutSyncService Service(Harness harness, Func<HttpRequestMessage, HttpResponseMessage> respond)
    {
        var http = new HttpClient(new Responder(respond));
        var google = new GoogleHealthService(http, harness.Db, new PlainKms(), harness.Config);
        return new GoogleHealthWorkoutSyncService(harness.Db, google, http, new GoogleHealthWorkoutSummaryService(harness.Db), (_, _) => Task.CompletedTask);
    }

    private static async Task<Guid> SeedDueUpload(Harness harness)
    {
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
        return work.Id;
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
