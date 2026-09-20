using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.Extensions.Configuration;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class FitnessConnectionClientTests
{
    [Fact]
    public async Task Exchange_uses_durable_connection_grant_and_owner_credentials()
    {
        var connectionId = Guid.NewGuid();
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"access_token\":\"short-lived\",\"expires_in\":300}")
        });
        var client = CreateClient(handler);

        var result = await client.Exchange(connectionId, CancellationToken.None);

        Assert.Equal("short-lived", result.AccessToken);
        Assert.Equal(300, result.ExpiresIn);
        Assert.Equal(HttpMethod.Post, handler.Method);
        Assert.Equal("https://fitness.example/connect/token", handler.Uri);
        Assert.Equal("Basic", handler.Authorization?.Scheme);
        Assert.Equal(Convert.ToBase64String(Encoding.UTF8.GetBytes("workout-api:workout-secret")), handler.Authorization?.Parameter);
        Assert.Contains("grant_type=fitness_connection", handler.Body);
        Assert.Contains($"connection_id={connectionId:D}", handler.Body);
        Assert.DoesNotContain("refresh_token", handler.Body);
    }

    [Fact]
    public async Task Owner_status_preserves_distinct_revoked_and_missing_results()
    {
        var id = Guid.NewGuid();
        var responses = new Queue<HttpResponseMessage>([
            Json(HttpStatusCode.OK, "{\"status\":\"revoked\",\"generation\":2}"),
            Json(HttpStatusCode.OK, "{\"status\":\"missing\",\"generation\":0}")
        ]);
        var handler = new RecordingHandler(_ => responses.Dequeue());
        var client = CreateClient(handler);

        var revoked = await client.GetStatus(id, CancellationToken.None);
        var missing = await client.GetStatus(id, CancellationToken.None);

        Assert.Equal("revoked", revoked.Status);
        Assert.Equal(2, revoked.Generation);
        Assert.Equal("missing", missing.Status);
        Assert.Equal($"https://fitness.example/internal/integrations/connections/{id:D}", handler.Uri);
    }

    [Fact]
    public async Task Receiver_validation_is_checked_against_the_central_service_each_time()
    {
        var id = Guid.NewGuid();
        var responses = new Queue<HttpResponseMessage>([
            Json(HttpStatusCode.OK, "{\"active\":true,\"generation\":3}"),
            Json(HttpStatusCode.Gone, "{\"active\":false}")
        ]);
        var handler = new RecordingHandler(_ => responses.Dequeue());
        var client = CreateClient(handler);

        Assert.True(await client.ValidateIncoming(id, 3, CancellationToken.None));
        Assert.False(await client.ValidateIncoming(id, 3, CancellationToken.None));
        Assert.Equal(2, handler.Calls);
        Assert.Contains("?generation=3", handler.Uri);
        Assert.Equal("Basic", handler.Authorization?.Scheme);
    }

    [Fact]
    public async Task Receiver_validation_fails_closed_when_central_status_is_unavailable()
    {
        var client = CreateClient(new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));

        var error = await Assert.ThrowsAsync<DomainException>(() => client.ValidateIncoming(Guid.NewGuid(), 1, CancellationToken.None));

        Assert.Equal(503, error.Status);
    }

    private static FitnessConnectionClient CreateClient(RecordingHandler handler)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Identity:Authority"] = "https://fitness.example",
            ["Identity:ClientId"] = "workout-api",
            ["Identity:ClientSecret"] = "workout-secret"
        }).Build();
        return new FitnessConnectionClient(new SingleClientFactory(handler), config);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string content)
        => new(status) { Content = new StringContent(content) };

    private sealed class SingleClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public HttpMethod? Method { get; private set; }
        public string? Uri { get; private set; }
        public AuthenticationHeaderValue? Authorization { get; private set; }
        public string Body { get; private set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            Method = request.Method;
            Uri = request.RequestUri?.ToString();
            Authorization = request.Headers.Authorization;
            Body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            return respond(request);
        }
    }
}
