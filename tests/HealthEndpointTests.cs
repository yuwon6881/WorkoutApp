using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Workout.Api.Data;
using Xunit;

namespace Workout.Tests;

public sealed class HealthEndpointTests
{
    [Fact]
    public async Task Plain_probe_stays_database_free_and_warm_up_probe_reports_readiness()
    {
        var path = Path.Combine(Path.GetTempPath(), $"workout-health-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new HealthFactory(path);
            using var scope = factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<AppDb>().Database.EnsureCreatedAsync();
            using var client = factory.CreateClient();

            var plain = await client.GetFromJsonAsync<JsonElement>("/health");
            Assert.Equal("ok", plain.GetProperty("status").GetString());
            Assert.False(plain.TryGetProperty("database", out _));

            var warm = await client.GetFromJsonAsync<JsonElement>("/health?db=1");
            Assert.Equal("ok", warm.GetProperty("status").GetString());
            Assert.Equal("ready", warm.GetProperty("database").GetString());
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); if (File.Exists(path)) File.Delete(path); }
    }

    private sealed class HealthFactory(string path) : WebApplicationFactory<Program>
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
