using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class GoogleHealthPassDeadlineTests
{
    [Fact]
    public async Task Pass_budget_cancels_a_provider_create_and_preserves_its_lease()
    {
        await using var harness = await Harness.Create(new() { ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret" });
        var user = await harness.SignIn();
        harness.Db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = user.Id, GoogleIdHash = "deadline", EncryptedRefreshToken = "refresh", Status = "connected",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWorkoutSyncService.WorkoutScope }), WorkoutSyncEnabled = true
        });
        harness.Db.GoogleHealthWorkoutSyncWork.Add(new GoogleHealthWorkoutSyncWork
        {
            UserId = user.Id, WorkoutSessionId = Guid.NewGuid(), GoogleIdHash = "deadline", ConnectionGeneration = 1,
            DesiredStartedAt = DateTime.UtcNow.AddHours(-1), DesiredFinishedAt = DateTime.UtcNow, DesiredName = "Workout",
            ProcessingState = "pending", NextAttemptAt = DateTime.UtcNow.AddMinutes(-1)
        });
        await harness.Db.SaveChangesAsync();
        var http = new HttpClient(new StalledProvider());
        var google = new GoogleHealthService(http, harness.Db, new PlainKms(), harness.Config);
        var sync = new GoogleHealthWorkoutSyncService(harness.Db, google, http, new GoogleHealthWorkoutSummaryService(harness.Db));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => sync.ProcessDueAsync(default, user.Id, TimeSpan.FromSeconds(2)));
        harness.Db.ChangeTracker.Clear();
        var row = await harness.Db.GoogleHealthWorkoutSyncWork.SingleAsync();
        Assert.Equal("processing", row.ProcessingState);
        Assert.NotNull(row.LeaseUntil);
        Assert.Equal(0, (await sync.ProcessDueAsync(default, user.Id)).Processed);
    }
    private sealed class PlainKms : IIntegrationKms
    {
        public Task<string> EncryptAsync(string value, CancellationToken ct) => Task.FromResult(value);
        public Task<string> DecryptAsync(string value, CancellationToken ct) => Task.FromResult(value);
    }
    private sealed class StalledProvider : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.RequestUri!.Host == "oauth2.googleapis.com") return new(HttpStatusCode.OK) {Content = new StringContent("{\"access_token\":\"token\"}")};
            await Task.Delay(TimeSpan.FromSeconds(5), ct);
            return new(HttpStatusCode.OK);
        }
    }
}
