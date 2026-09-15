using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Endpoints;
using Xunit;

namespace Workout.Tests;

public sealed class CentralAuthTests : IAsyncLifetime
{
    private readonly SqliteConnection connection = new("Data Source=:memory:");
    private AppDb db = null!;

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
    }

    public async Task DisposeAsync()
    {
        await db.DisposeAsync();
        await connection.DisposeAsync();
    }

    [Fact]
    public async Task Central_callback_provisions_unknown_subject_and_reuses_without_duplicating()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:MaxUsers"] = "2"
        }).Build();

        var user1 = await CentralAuthEndpoints.ProvisionOrGetUser(db, config, "sub_123", "Alice", default);
        Assert.NotNull(user1);
        Assert.Equal("Alice", user1.DisplayName);
        Assert.Equal("sub_123", user1.IdentitySubject);
        Assert.Equal(1, await db.Users.CountAsync());

        var user2 = await CentralAuthEndpoints.ProvisionOrGetUser(db, config, "sub_123", "Alice In Wonderland", default);
        Assert.Equal(user1.Id, user2.Id);
        Assert.Equal("Alice In Wonderland", user2.DisplayName);
        Assert.Equal(1, await db.Users.CountAsync());
    }

    [Fact]
    public async Task Provisioning_past_max_users_returns_403()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:MaxUsers"] = "2"
        }).Build();

        await CentralAuthEndpoints.ProvisionOrGetUser(db, config, "sub_1", "User 1", default);
        await CentralAuthEndpoints.ProvisionOrGetUser(db, config, "sub_2", "User 2", default);

        var ex = await Assert.ThrowsAsync<DomainException>(() =>
            CentralAuthEndpoints.ProvisionOrGetUser(db, config, "sub_3", "User 3", default));
        Assert.Equal(403, ex.Status);
        Assert.Contains("Registration is closed", ex.Message);
    }

    [Fact]
    public void Settings_throws_503_when_client_secret_is_placeholder_outside_development()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Identity:Authority"] = "https://fitness-account.example.invalid",
            ["Identity:ClientId"] = "workout-api",
            ["Identity:ClientSecret"] = "replace-in-secret-manager",
            ["Identity:RedirectUri"] = "https://workout-one-mocha.vercel.app/api/auth/central/callback"
        }).Build();

        var env = new TestHostEnvironment("Production");
        var ex = Assert.Throws<DomainException>(() => CentralAuthEndpoints.Settings(config, env));
        Assert.Equal(503, ex.Status);
        Assert.Contains("secret is not configured", ex.Message);
    }

    [Fact]
    public async Task Legacy_auth_routes_return_404()
    {
        using var factory = new WebApplicationFactory<Program>();
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("X-Workout-Request", "1");
        client.DefaultRequestHeaders.Add("Origin", "http://localhost");

        var registerRes = await client.PostAsJsonAsync("/api/auth/register", new { username = "test", password = "password123456" });
        Assert.Equal(HttpStatusCode.NotFound, registerRes.StatusCode);

        var loginRes = await client.PostAsJsonAsync("/api/auth/login", new { username = "test", password = "password123456" });
        Assert.Equal(HttpStatusCode.NotFound, loginRes.StatusCode);
    }

    private sealed class TestHostEnvironment(string environmentName) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environmentName;
        public string ApplicationName { get; set; } = "Test";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = null!;
    }
}
