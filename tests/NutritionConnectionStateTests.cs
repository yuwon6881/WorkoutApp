using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class NutritionConnectionStateTests
{
    private const string ContextUrl = "https://nutrition.test/api/integrations/v1/training-context";

    [Fact]
    public async Task Failed_data_refresh_keeps_a_centrally_confirmed_connection_connected_with_a_warning()
    {
        var central = new DelayedHandler(_ => JsonResponse("{\"status\":\"active\",\"generation\":4}"));
        var tempDb = Path.Combine(Path.GetTempPath(), $"workout-test-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestAppFactory(tempDb, central);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            var user = new AppUser { Id = Guid.NewGuid(), DisplayName = "Alice", IdentitySubject = "sub_test" };
            db.Users.Add(user);
            var token = Guid.NewGuid().ToString("N");
            db.Sessions.Add(new AuthSession { Hash = AuthService.Hash(token), UserId = user.Id, Expires = DateTime.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
            db.CurrentUser = user.Id;
            db.IntegrationGrants.Add(ActiveGrant(user.Id, 4));
            db.NutritionContexts.Add(new NutritionContextCache
            {
                UserId = user.Id,
                LastSuccessAt = DateTime.UtcNow.AddHours(-2),
                LastErrorAt = DateTime.UtcNow.AddMinutes(-1),
                LastError = "Nutrition data could not be refreshed right now."
            });
            await db.SaveChangesAsync();
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            client.DefaultRequestHeaders.Add("Cookie", $"{AuthService.Cookie}={token}");

            using var response = await client.GetAsync("/api/integrations/connected");

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var row = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement[0];
            Assert.Equal("connected", row.GetProperty("connectionState").GetString());
            Assert.True(row.GetProperty("syncWarning").GetBoolean());
        }
        finally
        {
            try { File.Delete(tempDb); } catch { }
        }
    }

    [Fact]
    public async Task Inactive_connection_does_not_let_a_fresh_cached_goal_steer_progression()
    {
        await using var harness = await Harness.Create(new() { ["Integrations:NutritionTrainingContextUrl"] = ContextUrl });
        var user = await harness.SignIn();
        var grant = ActiveGrant(user.Id, 2);
        grant.Status = "reconnect_required";
        harness.Db.IntegrationGrants.Add(grant);
        harness.Db.NutritionContexts.Add(new NutritionContextCache
        {
            UserId = user.Id,
            ContextJson = Json.Write(LosingContext(user.IdentitySubject, DateTime.UtcNow)),
            LastSuccessAt = DateTime.UtcNow.AddHours(-1)
        });
        await harness.Db.SaveChangesAsync();
        var nutrition = new DelayedHandler(_ => throw new InvalidOperationException("An inactive connection must not call Nutrition."));
        var service = new NutritionContextService(harness.Db, new SingleClientFactory(nutrition), harness.Config);

        var result = await service.Get(CancellationToken.None);

        Assert.Equal(ProgressionModes.Normal, result.Mode);
        Assert.Null(result.Context);
        Assert.Equal(0, nutrition.Calls);
    }

    [Fact]
    public async Task Explicit_refresh_waits_out_a_cold_start_that_workout_start_does_not()
    {
        await using var harness = await Harness.Create(new() { ["Integrations:NutritionTrainingContextUrl"] = ContextUrl });
        var user = await harness.SignIn();
        harness.Db.IntegrationGrants.Add(ActiveGrant(user.Id, 2));
        await harness.Db.SaveChangesAsync();
        var body = Json.Write(LosingContext(user.IdentitySubject, DateTime.UtcNow));
        var nutrition = new DelayedHandler(_ => JsonResponse(body), TimeSpan.FromMilliseconds(2300));
        var service = new NutritionContextService(harness.Db, new SingleClientFactory(nutrition), harness.Config);

        var result = await service.Get(CancellationToken.None, NutritionContextService.RefreshDeadline);

        Assert.Null(result.Error);
        Assert.False(result.Cached);
        Assert.True(NutritionContextService.StartDeadline < TimeSpan.FromMilliseconds(2300));
    }

    private static NutritionTrainingContext LosingContext(string subject, DateTime retrievedAt)
        => new(subject, 3, "UTC", "lose", false, .8, null, null, 80, null, 79, null, retrievedAt, true);

    private static IntegrationGrant ActiveGrant(Guid userId, long generation)
        => new()
        {
            UserId = userId,
            Peer = "nutrition",
            Status = "active",
            CentralConnectionId = Guid.NewGuid(),
            CentralConnectionGeneration = generation,
            ScopesJson = "[\"nutrition.training_context.read\"]"
        };

    private static HttpResponseMessage JsonResponse(string body)
        => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed class TestAppFactory(string dbPath, HttpMessageHandler central) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:SqlitePath"] = dbPath,
                ["PublicOrigin"] = "https://localhost",
                ["Identity:Authority"] = "https://fitness-account.example.invalid",
                ["Identity:ClientId"] = "workout-api",
                ["Identity:ClientSecret"] = "secret"
            }));
            builder.ConfigureTestServices(services =>
                services.AddSingleton<IHttpClientFactory>(new SingleClientFactory(central)));
        }
    }

    private sealed class SingleClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class DelayedHandler(Func<HttpRequestMessage, HttpResponseMessage> respond, TimeSpan delay = default) : HttpMessageHandler
    {
        private int calls;
        public int Calls => calls;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Interlocked.Increment(ref calls);
            if (delay > TimeSpan.Zero) await Task.Delay(delay, ct);
            return respond(request);
        }
    }
}
