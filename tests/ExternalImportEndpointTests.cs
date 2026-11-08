using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Workout.Api.Data;
using Workout.Api.Endpoints;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ExternalImportEndpointTests
{
    [Fact]
    public async Task Upload_returns_a_draft_owned_only_by_the_uploader()
    {
        using var factory = new Factory(Path.Combine(Path.GetTempPath(), $"external-{Guid.NewGuid():N}.db"));
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            foreach (var token in new[] { "owner", "other" })
            {
                var user = new AppUser { Id = Guid.NewGuid(), DisplayName = token, IdentitySubject = Guid.NewGuid().ToString() };
                db.Users.Add(user);
                db.Sessions.Add(new AuthSession { UserId = user.Id, Hash = AuthService.Hash(token), Expires = DateTime.UtcNow.AddDays(1) });
            }
            await db.SaveChangesAsync();
        }
        using var owner = Client(factory, "owner");
        const string file = """{"version":1,"program":{"name":"Plan","days":[{"key":"a","week":1,"name":"Day","exercises":[{"sourceName":"Press","sets":[{"repMin":5,"repMax":5}]}]}]}}""";
        var response = await owner.PostAsync("/api/imports/external", new StringContent(file, Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var view = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Plan", view.GetProperty("draft").GetProperty("programName").GetString());
        var id = view.GetProperty("id").GetString();
        using var other = Client(factory, "other");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/imports/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync($"/api/imports/{id}/accept", new { revision = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync($"/api/imports/{id}")).StatusCode);
    }

    private static HttpClient Client(Factory factory, string token)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Cookie", $"{AuthService.Cookie}={token}");
        client.DefaultRequestHeaders.Add("Origin", "https://localhost");
        client.DefaultRequestHeaders.Add("X-Workout-Request", "1");
        return client;
    }

    [Theory]
    [InlineData("wrong-type", HttpStatusCode.UnsupportedMediaType)]
    [InlineData("malformed", HttpStatusCode.BadRequest)]
    [InlineData("truncated", HttpStatusCode.BadRequest)]
    [InlineData("oversize", HttpStatusCode.RequestEntityTooLarge)]
    [InlineData("oversize-stream", HttpStatusCode.RequestEntityTooLarge)]
    public async Task Invalid_uploads_return_an_error_without_creating_a_draft(string kind, HttpStatusCode expected)
    {
        using var factory = new Factory(Path.Combine(Path.GetTempPath(), $"external-{Guid.NewGuid():N}.db"));
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            var user = new AppUser { Id = Guid.NewGuid(), DisplayName = "Test", IdentitySubject = Guid.NewGuid().ToString() };
            db.Users.Add(user);
            db.Sessions.Add(new AuthSession { UserId = user.Id, Hash = AuthService.Hash("invalid-token"), Expires = DateTime.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
        }
        using var client = Client(factory, "invalid-token");
        HttpContent body = kind == "oversize-stream" ? new UnknownLengthContent(new byte[ExternalImportRequest.MaxBytes + 1])
            : kind == "oversize" ? new ByteArrayContent(new byte[ExternalImportRequest.MaxBytes + 1])
            : new StringContent(kind == "truncated" ? "{\"version\":1," : "{bad", Encoding.UTF8,
                kind == "wrong-type" ? "text/plain" : "application/json");
        if (kind.StartsWith("oversize", StringComparison.Ordinal)) body.Headers.ContentType = new("application/json");
        var response = await client.PostAsync("/api/imports/external", body);
        Assert.Equal(expected, response.StatusCode);
        using var check = factory.Services.CreateScope();
        Assert.Empty(check.ServiceProvider.GetRequiredService<AppDb>().Imports.IgnoreQueryFilters());
        Assert.Empty(check.ServiceProvider.GetRequiredService<AppDb>().Programs.IgnoreQueryFilters());
    }

    private sealed class UnknownLengthContent(byte[] data) : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, System.Net.TransportContext? context) => stream.WriteAsync(data).AsTask();
        protected override bool TryComputeLength(out long length) { length = 0; return false; }
    }

    [Fact]
    public async Task Rate_limit_is_per_account_and_recovers_after_the_window()
    {
        using var factory = new Factory(Path.Combine(Path.GetTempPath(), $"external-{Guid.NewGuid():N}.db"), 5);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            foreach (var token in new[] { "rate-a", "rate-b" })
            {
                var user = new AppUser { Id = Guid.NewGuid(), DisplayName = token, IdentitySubject = Guid.NewGuid().ToString() };
                db.Users.Add(user);
                db.Sessions.Add(new AuthSession { UserId = user.Id, Hash = AuthService.Hash(token), Expires = DateTime.UtcNow.AddDays(1) });
                if (token == "rate-a") db.Sessions.Add(new AuthSession { UserId = user.Id, Hash = AuthService.Hash("rate-a-second-session"), Expires = DateTime.UtcNow.AddDays(1) });
            }
            await db.SaveChangesAsync();
        }
        using var first = Client(factory, "rate-a");
        using var second = Client(factory, "rate-b");
        using var sameAccount = Client(factory, "rate-a-second-session");
        for (var i = 0; i < 10; i++)
            Assert.Equal(HttpStatusCode.BadRequest, (await first.PostAsync("/api/imports/external", new StringContent("{}", Encoding.UTF8, "application/json"))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await first.PostAsync("/api/imports/external", new StringContent("{}", Encoding.UTF8, "application/json"))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await sameAccount.PostAsync("/api/imports/external", new StringContent("{}", Encoding.UTF8, "application/json"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await second.PostAsync("/api/imports/external", new StringContent("{}", Encoding.UTF8, "application/json"))).StatusCode);
        await Task.Delay(TimeSpan.FromSeconds(6));
        Assert.Equal(HttpStatusCode.BadRequest, (await first.PostAsync("/api/imports/external", new StringContent("{}", Encoding.UTF8, "application/json"))).StatusCode);
    }

    [Fact]
    public async Task Requires_a_session()
    {
        using var factory = new Factory(Path.Combine(Path.GetTempPath(), $"external-{Guid.NewGuid():N}.db"));
        using var client = factory.CreateClient();
        var response = await client.PostAsync("/api/imports/external", new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Reports_invalid_version_as_a_field_error_without_creating_a_draft()
    {
        using var factory = new Factory(Path.Combine(Path.GetTempPath(), $"external-{Guid.NewGuid():N}.db"));
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            var user = new AppUser { Id = Guid.NewGuid(), DisplayName = "Test", IdentitySubject = Guid.NewGuid().ToString() };
            db.Users.Add(user);
            db.Sessions.Add(new AuthSession { UserId = user.Id, Hash = AuthService.Hash("test-token"), Expires = DateTime.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
        }
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Cookie", $"{AuthService.Cookie}=test-token");
        client.DefaultRequestHeaders.Add("Origin", "https://localhost");
        client.DefaultRequestHeaders.Add("X-Workout-Request", "1");
        var response = await client.PostAsync("/api/imports/external", new StringContent("{\"version\":2,\"program\":{}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("$.version", body.GetProperty("errors")[0].GetProperty("path").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("errors")[0].GetProperty("message").GetString()));
        using var check = factory.Services.CreateScope();
        Assert.Empty(check.ServiceProvider.GetRequiredService<AppDb>().Imports.IgnoreQueryFilters());
    }

    [Fact]
    public async Task Reports_multiple_independent_field_errors_in_one_response()
    {
        using var factory = new Factory(Path.Combine(Path.GetTempPath(), $"external-{Guid.NewGuid():N}.db"));
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            var user = new AppUser { Id = Guid.NewGuid(), DisplayName = "Test", IdentitySubject = Guid.NewGuid().ToString() };
            db.Users.Add(user);
            db.Sessions.Add(new AuthSession { UserId = user.Id, Hash = AuthService.Hash("errors-token"), Expires = DateTime.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
        }
        using var client = Client(factory, "errors-token");
        const string invalid = """{"version":1,"program":{"name":"Plan","days":[{"key":"a","week":1,"name":"Day","exercises":[{"sourceName":"Press","badField":true,"otherField":1,"sets":[{}]},{"sourceName":"Squat","extraField":1,"sets":[{}]}]}]}}""";
        var response = await client.PostAsync("/api/imports/external", new StringContent(invalid, Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var paths = body.GetProperty("errors").EnumerateArray().Select(error => error.GetProperty("path").GetString()).ToArray();
        Assert.Contains("$.program.days[0].exercises[0].badField", paths);
        Assert.Contains("$.program.days[0].exercises[0].otherField", paths);
        Assert.Contains("$.program.days[0].exercises[1].extraField", paths);
        using var check = factory.Services.CreateScope();
        Assert.Empty(check.ServiceProvider.GetRequiredService<AppDb>().Imports.IgnoreQueryFilters());
    }

    private sealed class Factory(string path, int? windowSeconds = null) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:SqlitePath"] = path, ["PublicOrigin"] = "https://localhost",
                ["RateLimits:ExternalImportWindowSeconds"] = windowSeconds?.ToString()
            }));
        }
    }
}
