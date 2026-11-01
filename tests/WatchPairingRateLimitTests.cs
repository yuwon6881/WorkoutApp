using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Cloud Run reaches the API from shared front-end addresses, so pairing limits must follow the
/// caller Cloud Run appends to X-Forwarded-For rather than pool every watch behind one address.
public sealed class WatchPairingRateLimitTests
{
    [Fact]
    public async Task Pairing_start_limit_follows_the_forwarded_caller_and_ignores_client_written_entries()
    {
        var path = Path.Combine(Path.GetTempPath(), $"workout-watch-limit-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new WatchFactory(path);
            using var scope = factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<AppDb>().Database.EnsureCreatedAsync();
            using var client = factory.CreateClient();

            // Five starts per caller per window; each request varies the entry a client could forge.
            for (var attempt = 0; attempt < 5; attempt++)
                Assert.NotEqual(HttpStatusCode.TooManyRequests, (await Start(client, $"198.51.100.{attempt}, 203.0.113.10")).StatusCode);
            Assert.Equal(HttpStatusCode.TooManyRequests, (await Start(client, "198.51.100.99, 203.0.113.10")).StatusCode);

            Assert.NotEqual(HttpStatusCode.TooManyRequests, (await Start(client, "203.0.113.20")).StatusCode);
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); if (File.Exists(path)) File.Delete(path); }
    }

    private static Task<HttpResponseMessage> Start(HttpClient client, string forwardedFor)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/watch/pairing/start")
        {
            Content = JsonContent.Create(new { deviceId = "", deviceName = "", deviceToken = "" })
        };
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        request.Headers.Add(WatchAuthentication.WearClientHeader, "1");
        return client.SendAsync(request);
    }

    private sealed class WatchFactory(string path) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:SqlitePath"] = path, ["PublicOrigin"] = "https://localhost"
            }));
        }
    }
}
