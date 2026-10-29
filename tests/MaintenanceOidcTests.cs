using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Maintenance routes accept a Google identity token from an allow-listed caller, so Cloud Scheduler
/// needs no shared secret. The legacy header works only while `Maintenance:Secret` is configured, and
/// every refusal stays a 404 so the routes are not discoverable.
public sealed class MaintenanceOidcTests
{
    private const string Audience = "https://workout.example.test";
    private const string Caller = "workout-internal@project.iam.gserviceaccount.com";

    [Theory]
    [InlineData("/internal/google-health-workout-sync")]
    [InlineData("/internal/import-maintenance")]
    public async Task Allow_listed_caller_with_a_valid_identity_token_is_accepted(string route) =>
        Assert.Equal(HttpStatusCode.OK, await Post(route, "caller-token"));

    [Theory]
    [InlineData("stranger-token")]
    [InlineData("forged-token")]
    [InlineData(null)]
    public async Task Other_callers_get_not_found(string? bearer) =>
        Assert.Equal(HttpStatusCode.NotFound, await Post("/internal/import-maintenance", bearer));

    [Fact]
    public async Task Missing_audience_configuration_fails_closed() =>
        Assert.Equal(HttpStatusCode.NotFound, await Post("/internal/import-maintenance", "caller-token", audience: null));

    [Fact]
    public async Task Legacy_header_is_refused_once_the_secret_is_not_configured() =>
        Assert.Equal(HttpStatusCode.NotFound,
            await Post("/internal/import-maintenance", bearer: null, legacyHeader: "old-secret", legacyConfigured: false));

    [Fact]
    public async Task Legacy_header_still_works_while_the_secret_is_configured() =>
        Assert.Equal(HttpStatusCode.OK,
            await Post("/internal/import-maintenance", bearer: null, legacyHeader: "old-secret", legacyConfigured: true));

    private static async Task<HttpStatusCode> Post(string route, string? bearer, string? audience = Audience,
        string? legacyHeader = null, bool legacyConfigured = false)
    {
        var tempDb = Path.Combine(Path.GetTempPath(), $"workout-oidc-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestFactory(tempDb, audience, legacyConfigured);
            using (var scope = factory.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDb>().Database.EnsureCreatedAsync();
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            using var request = new HttpRequestMessage(HttpMethod.Post, route);
            if (bearer is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            if (legacyHeader is not null) request.Headers.Add("X-Workout-Maintenance-Secret", legacyHeader);
            using var response = await client.SendAsync(request);
            return response.StatusCode;
        }
        finally
        {
            try { File.Delete(tempDb); } catch { }
        }
    }

    private sealed class TestFactory(string dbPath, string? audience, bool legacyConfigured) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                var values = new Dictionary<string, string?>
                {
                    ["Database:SqlitePath"] = dbPath,
                    ["PublicOrigin"] = "https://localhost",
                    ["Maintenance:AllowedCallers"] = $"{Caller}, operator@example.test",
                };
                if (audience is not null) values["Maintenance:Audience"] = audience;
                if (legacyConfigured) values["Maintenance:Secret"] = "old-secret";
                config.AddInMemoryCollection(values);
            });
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IMaintenanceTokenVerifier>();
                services.AddSingleton<IMaintenanceTokenVerifier, FakeVerifier>();
            });
        }
    }

    private sealed class FakeVerifier : IMaintenanceTokenVerifier
    {
        public Task<string?> VerifiedEmail(string token, string audience, CancellationToken ct) =>
            Task.FromResult<string?>(audience != Audience ? null : token switch
            {
                "caller-token" => Caller,
                "stranger-token" => "stranger@example.test",
                _ => null,
            });
    }
}
