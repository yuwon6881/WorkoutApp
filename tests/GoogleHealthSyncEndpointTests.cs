using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Workout.Api.Data;
using Xunit;

namespace Workout.Tests;

public sealed class GoogleHealthSyncEndpointTests
{
    private const string Secret = "scheduler-secret";

    [Theory]
    [InlineData(null)]
    [InlineData("wrong-secret")]
    public async Task Background_sync_rejects_callers_without_the_maintenance_secret(string? presented)
    {
        using var response = await Post(presented);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Background_sync_runs_for_the_scheduler_secret()
    {
        using var response = await Post(Secret);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task<HttpResponseMessage> Post(string? presented)
    {
        var tempDb = Path.Combine(Path.GetTempPath(), $"workout-test-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestAppFactory(tempDb);
            using (var scope = factory.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDb>().Database.EnsureCreatedAsync();
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            using var request = new HttpRequestMessage(HttpMethod.Post, "/internal/google-health-workout-sync");
            if (presented is not null) request.Headers.Add("X-Workout-Maintenance-Secret", presented);
            return await client.SendAsync(request);
        }
        finally
        {
            try { File.Delete(tempDb); } catch { }
        }
    }

    private sealed class TestAppFactory(string dbPath) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:SqlitePath"] = dbPath,
                ["PublicOrigin"] = "https://localhost",
                ["Maintenance:Secret"] = Secret
            }));
        }
    }
}
