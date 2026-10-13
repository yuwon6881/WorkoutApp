using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class WatchActiveConditionalTests : IAsyncDisposable
{
    private readonly string dbPath;
    private readonly WebApplicationFactory<Program> factory;
    private readonly HttpClient client;

    public WatchActiveConditionalTests()
    {
        dbPath = Path.Combine(Path.GetTempPath(), $"watch_conditional_{Guid.NewGuid():N}.db");
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Database:SqlitePath", dbPath);
        });
        client = factory.CreateClient();
    }

    [Fact]
    public async Task With_no_active_workout_returns_200_with_etag_then_304()
    {
        var (user, token) = await CreateUserAndPairedDeviceToken("user_no_active");
        using var clientForUser = CreateWatchClient(token);

        // First GET with no active workout returns 200 with ETag
        var firstRes = await clientForUser.GetAsync("/api/watch/active");
        Assert.Equal(HttpStatusCode.OK, firstRes.StatusCode);
        var etag = firstRes.Headers.ETag?.ToString();
        Assert.NotNull(etag);
        Assert.NotEmpty(etag);

        // Repeating with If-None-Match returns 304 with empty body
        using var repeatReq = new HttpRequestMessage(HttpMethod.Get, "/api/watch/active");
        repeatReq.Headers.TryAddWithoutValidation("If-None-Match", etag);
        var repeatRes = await clientForUser.SendAsync(repeatReq);
        Assert.Equal(HttpStatusCode.NotModified, repeatRes.StatusCode);
        Assert.Equal(etag, repeatRes.Headers.ETag?.ToString());
        var body = await repeatRes.Content.ReadAsStringAsync();
        Assert.Empty(body);
    }

    [Fact]
    public async Task Active_workout_first_get_returns_200_with_etag_and_repeating_returns_304()
    {
        var (user, token) = await CreateUserAndPairedDeviceToken("user_active_repeat");
        using var clientForUser = CreateWatchClient(token);

        await StartWorkoutWithSet(user.Id);

        // First GET returns 200 with ETag
        var firstRes = await clientForUser.GetAsync("/api/watch/active");
        Assert.Equal(HttpStatusCode.OK, firstRes.StatusCode);
        var etag = firstRes.Headers.ETag?.ToString();
        Assert.NotNull(etag);

        // Repeating with If-None-Match returns 304 with empty body
        using var repeatReq = new HttpRequestMessage(HttpMethod.Get, "/api/watch/active");
        repeatReq.Headers.TryAddWithoutValidation("If-None-Match", etag);
        var repeatRes = await clientForUser.SendAsync(repeatReq);
        Assert.Equal(HttpStatusCode.NotModified, repeatRes.StatusCode);
        Assert.Equal(etag, repeatRes.Headers.ETag?.ToString());
        var body = await repeatRes.Content.ReadAsStringAsync();
        Assert.Empty(body);
    }

    [Fact]
    public async Task Set_patch_on_active_workout_returns_200_and_new_etag()
    {
        var (user, token) = await CreateUserAndPairedDeviceToken("user_patch");
        using var clientForUser = CreateWatchClient(token);

        var (workoutId, setId, revision) = await StartWorkoutWithSet(user.Id);

        // Get initial ETag
        var firstRes = await clientForUser.GetAsync("/api/watch/active");
        Assert.Equal(HttpStatusCode.OK, firstRes.StatusCode);
        var initialEtag = firstRes.Headers.ETag?.ToString();
        Assert.NotNull(initialEtag);

        // Patch the set via watch endpoint
        using var patchReq = new HttpRequestMessage(HttpMethod.Patch, $"/api/watch/workouts/{workoutId}/sets/{setId}")
        {
            Content = new StringContent(
                $$"""{"revision":{{revision}},"mutationId":"{{Guid.NewGuid()}}","weightKg":65,"reps":8,"done":true}""",
                Encoding.UTF8, "application/json")
        };
        var patchRes = await clientForUser.SendAsync(patchReq);
        Assert.Equal(HttpStatusCode.OK, patchRes.StatusCode);

        // Requesting with the old tag returns 200 and a new ETag
        using var checkReq = new HttpRequestMessage(HttpMethod.Get, "/api/watch/active");
        checkReq.Headers.TryAddWithoutValidation("If-None-Match", initialEtag);
        var checkRes = await clientForUser.SendAsync(checkReq);
        Assert.Equal(HttpStatusCode.OK, checkRes.StatusCode);
        var newEtag = checkRes.Headers.ETag?.ToString();
        Assert.NotNull(newEtag);
        Assert.NotEqual(initialEtag, newEtag);
    }

    [Fact]
    public async Task Preference_change_returns_200_with_new_etag()
    {
        var (user, token) = await CreateUserAndPairedDeviceToken("user_pref");
        using var clientForUser = CreateWatchClient(token);

        await StartWorkoutWithSet(user.Id);

        // Get initial ETag
        var firstRes = await clientForUser.GetAsync("/api/watch/active");
        Assert.Equal(HttpStatusCode.OK, firstRes.StatusCode);
        var initialEtag = firstRes.Headers.ETag?.ToString();
        Assert.NotNull(initialEtag);

        // Verify 304 before preference change
        using var repeatReq = new HttpRequestMessage(HttpMethod.Get, "/api/watch/active");
        repeatReq.Headers.TryAddWithoutValidation("If-None-Match", initialEtag);
        var repeatRes = await clientForUser.SendAsync(repeatReq);
        Assert.Equal(HttpStatusCode.NotModified, repeatRes.StatusCode);

        // Update user preference (unit from kg to lb)
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            db.CurrentUser = user.Id;
            var userRow = await db.Users.SingleAsync(u => u.Id == user.Id);
            userRow.Unit = "lb";
            await db.SaveChangesAsync();
        }

        // Requesting with initial ETag now returns 200 and new ETag
        using var checkReq = new HttpRequestMessage(HttpMethod.Get, "/api/watch/active");
        checkReq.Headers.TryAddWithoutValidation("If-None-Match", initialEtag);
        var checkRes = await clientForUser.SendAsync(checkReq);
        Assert.Equal(HttpStatusCode.OK, checkRes.StatusCode);
        var newEtag = checkRes.Headers.ETag?.ToString();
        Assert.NotNull(newEtag);
        Assert.NotEqual(initialEtag, newEtag);
    }

    [Fact]
    public async Task Rest_deadline_elapsed_returns_200_with_new_etag()
    {
        var (user, token) = await CreateUserAndPairedDeviceToken("user_rest");
        using var clientForUser = CreateWatchClient(token);

        var (workoutId, _, _) = await StartWorkoutWithSet(user.Id);

        // Start a running rest with a future deadline
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            db.CurrentUser = user.Id;
            var session = await db.Workouts.SingleAsync(w => w.Id == workoutId);
            session.RestStatus = WorkoutRestStatus.Running;
            session.RestDeadlineUtc = DateTime.UtcNow.AddMinutes(5);
            await db.SaveChangesAsync();
        }

        var runningRes = await clientForUser.GetAsync("/api/watch/active");
        Assert.Equal(HttpStatusCode.OK, runningRes.StatusCode);
        var runningEtag = runningRes.Headers.ETag?.ToString();
        Assert.NotNull(runningEtag);

        // Transition the deadline to the past without modifying any other field
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            db.CurrentUser = user.Id;
            var session = await db.Workouts.SingleAsync(w => w.Id == workoutId);
            session.RestDeadlineUtc = DateTime.UtcNow.AddSeconds(-5);
            await db.SaveChangesAsync();
        }

        // Tag now computes restElapsed = 1, so the previous tag returns 200 with new ETag
        using var elapsedReq = new HttpRequestMessage(HttpMethod.Get, "/api/watch/active");
        elapsedReq.Headers.TryAddWithoutValidation("If-None-Match", runningEtag);
        var elapsedRes = await clientForUser.SendAsync(elapsedReq);
        Assert.Equal(HttpStatusCode.OK, elapsedRes.StatusCode);
        var elapsedEtag = elapsedRes.Headers.ETag?.ToString();
        Assert.NotNull(elapsedEtag);
        Assert.NotEqual(runningEtag, elapsedEtag);
    }

    private HttpClient CreateWatchClient(string token)
    {
        var watchClient = factory.CreateClient();
        watchClient.DefaultRequestHeaders.Add(WatchAuthentication.DeviceTokenHeader, token);
        return watchClient;
    }

    private async Task<(AppUser User, string DeviceToken)> CreateUserAndPairedDeviceToken(string username)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var pairings = scope.ServiceProvider.GetRequiredService<WatchPairingService>();

        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            DisplayName = username,
            IdentitySubject = $"sub_{Guid.NewGuid():N}",
            Unit = "kg",
            RestSeconds = 90,
            TrackRir = true
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        db.CurrentUser = user.Id;
        var token = NewSecret();
        var challenge = await pairings.Start($"watch_install_{Guid.NewGuid():N}", "Wear Test Watch", token, default);
        await pairings.Approve(challenge.Code, default);

        return (user, token);
    }

    private async Task<(Guid WorkoutId, Guid SetId, int Revision)> StartWorkoutWithSet(Guid userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var templates = scope.ServiceProvider.GetRequiredService<TemplateService>();
        var workouts = scope.ServiceProvider.GetRequiredService<WorkoutService>();

        db.CurrentUser = null;
        if (!await db.Exercises.AnyAsync(e => e.Slug == "bench"))
        {
            await CatalogSeed.Apply(db, [new SeedExercise("bench", "Bench press", "Chest", "Barbell", null)], false, default);
        }
        var exerciseId = (await db.Exercises.SingleAsync(e => e.Slug == "bench")).Id;

        db.CurrentUser = userId;
        var template = await templates.Create(
            new TemplateInput("Push", "Chest", null,
                [new TemplateExerciseInput(exerciseId, "Bench press", null, [new SetPrescription(8, 10, 8, 90, null, null, null)])],
                null, null),
            null, 1, 0, default);

        var session = await workouts.Start(template.Id, null, default);
        var setId = session.Exercises.Single().Sets.Single().Id;
        return (session.Id, setId, session.Revision);
    }

    private static string NewSecret()
        => Convert.ToBase64String(Guid.NewGuid().ToByteArray()) + Convert.ToBase64String(Guid.NewGuid().ToByteArray());

    public async ValueTask DisposeAsync()
    {
        client.Dispose();
        await factory.DisposeAsync();
        SqliteConnection.ClearAllPools();
        try
        {
            if (File.Exists(dbPath)) File.Delete(dbPath);
        }
        catch
        {
            // Ignore temp file cleanup error
        }
    }
}
