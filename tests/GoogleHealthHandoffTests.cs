using System.Net;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Google refuses its consent screen inside the Android WebView, so the app opens it in a Custom Tab
/// that has no Workout session. The callback can therefore only park the result; the app that started
/// the connection finishes it with its own session and the verifier only it holds.
public sealed class GoogleHealthHandoffTests
{
    private const string Verifier = "app-held-verifier-0123456789abcdefghijklmnopqrstuvwxyz";
    private const string Session = "session-hash-a";

    private static Dictionary<string, string?> Settings => new()
    {
        ["GoogleHealth:ClientId"] = "client",
        ["GoogleHealth:ClientSecret"] = "secret",
        ["PublicOrigin"] = "https://workout.test"
    };

    private static GoogleHealthService Service(Harness h, List<string>? calls = null) => new(new HttpClient(new Responder(request =>
    {
        calls?.Add(request.RequestUri!.Host);
        return request.RequestUri!.Host == "oauth2.googleapis.com"
            ? Json("{\"access_token\":\"access\",\"refresh_token\":\"refresh\",\"scope\":\"openid\"}")
            : Json("{\"sub\":\"google-user\"}");
    })), h.Db, new PlainKms(), h.Config);

    private static string StateOf(string authUrl)
    {
        var query = new Uri(authUrl).Query.TrimStart('?').Split('&').Select(part => part.Split('=', 2));
        return Uri.UnescapeDataString(query.Single(pair => pair[0] == "state")[1]);
    }

    [Fact]
    public async Task The_starting_app_session_finishes_a_connection_consented_in_a_browser_without_a_session()
    {
        await using var h = await Harness.Create(Settings);
        var user = await h.SignIn();
        var service = Service(h);
        var state = StateOf((await service.GenerateConnectUrlAsync(user.Id, Session, null, default, true, Verifier)).AuthUrl);

        var redirect = await service.DeferHandoffAsync("google-code", state, null, default);
        Assert.Equal("/open/settings?google_health=handoff", redirect);
        Assert.False(await h.Db.GoogleHealthConnections.IgnoreQueryFilters().AnyAsync());

        var result = await service.CompleteHandoffAsync(user.Id, Session, state, Verifier, null, default);

        Assert.Equal("connected", result.Status);
        Assert.True(await h.Db.GoogleHealthConnections.AnyAsync(c => c.UserId == user.Id && c.Status == "connected"));
        Assert.False(await h.Db.GoogleHealthOAuthStates.IgnoreQueryFilters().AnyAsync());
    }

    [Fact]
    public async Task A_wrong_verifier_or_another_session_cannot_finish_the_connection()
    {
        await using var h = await Harness.Create(Settings);
        var user = await h.SignIn();
        var calls = new List<string>();
        var service = Service(h, calls);
        var state = StateOf((await service.GenerateConnectUrlAsync(user.Id, Session, null, default, true, Verifier)).AuthUrl);
        await service.DeferHandoffAsync("google-code", state, null, default);

        var wrongVerifier = await service.CompleteHandoffAsync(user.Id, Session, state, Verifier + "x", null, default);
        var otherSession = await service.CompleteHandoffAsync(user.Id, "session-hash-b", state, Verifier, null, default);
        var otherUser = await service.CompleteHandoffAsync(Guid.NewGuid(), Session, state, Verifier, null, default);

        Assert.All(new[] { wrongVerifier, otherSession, otherUser }, result => Assert.Equal("error", result.Status));
        Assert.Empty(calls);
        Assert.False(await h.Db.GoogleHealthConnections.IgnoreQueryFilters().AnyAsync());
    }

    [Fact]
    public async Task Finishing_before_consent_reports_pending_and_keeps_the_state()
    {
        await using var h = await Harness.Create(Settings);
        var user = await h.SignIn();
        var service = Service(h);
        var state = StateOf((await service.GenerateConnectUrlAsync(user.Id, Session, null, default, true, Verifier)).AuthUrl);

        var result = await service.CompleteHandoffAsync(user.Id, Session, state, Verifier, null, default);

        Assert.Equal("pending", result.Status);
        Assert.True(await h.Db.GoogleHealthOAuthStates.IgnoreQueryFilters().AnyAsync(s => s.State == state));
    }

    [Fact]
    public async Task A_declined_consent_is_reported_to_the_app_once()
    {
        await using var h = await Harness.Create(Settings);
        var user = await h.SignIn();
        var service = Service(h);
        var state = StateOf((await service.GenerateConnectUrlAsync(user.Id, Session, null, default, true, Verifier)).AuthUrl);

        await service.DeferHandoffAsync(null, state, "access_denied", default);
        var first = await service.CompleteHandoffAsync(user.Id, Session, state, Verifier, null, default);
        var second = await service.CompleteHandoffAsync(user.Id, Session, state, Verifier, null, default);

        Assert.Equal(("error", "access_denied"), (first.Status, first.Code));
        Assert.Equal(("error", "invalid_state"), (second.Status, second.Code));
    }

    [Fact]
    public async Task A_browser_connection_without_a_verifier_keeps_the_session_bound_callback()
    {
        await using var h = await Harness.Create(Settings);
        var user = await h.SignIn();
        var service = Service(h);
        var state = StateOf((await service.GenerateConnectUrlAsync(user.Id, Session, null, default, true)).AuthUrl);

        Assert.Null(await service.DeferHandoffAsync("google-code", state, null, default));
        var refused = await service.CompleteHandoffAsync(user.Id, Session, state, "", null, default);

        Assert.Equal("error", refused.Status);
        Assert.Equal("/settings?google_health=connected", await service.HandleCallbackAsync("google-code", state, null, user.Id, Session, null, default));
    }

    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body) };

    private sealed class Responder(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(respond(request));
    }

    private sealed class PlainKms : IIntegrationKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult("enc:" + plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext["enc:".Length..]);
    }
}
