using System.Net;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class CentralIdentityReadinessTests
{
    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task Waits_for_a_scaled_to_zero_identity_service(HttpStatusCode firstStatus)
    {
        var handler = new SequenceHandler(firstStatus, HttpStatusCode.OK);
        using var client = new HttpClient(handler);

        var ready = await CentralIdentityReadiness.WaitForReady(
            client, "https://fitness-account.example.invalid", CancellationToken.None);

        Assert.True(ready);
        Assert.Equal(2, handler.Requests);
        Assert.All(handler.Paths, path => Assert.Equal("/health", path));
    }

    [Fact]
    public async Task Does_not_redirect_to_an_unhealthy_identity_service()
    {
        var handler = new SequenceHandler(HttpStatusCode.Forbidden);
        using var client = new HttpClient(handler);

        var ready = await CentralIdentityReadiness.WaitForReady(
            client, "https://fitness-account.example.invalid", CancellationToken.None);

        Assert.False(ready);
        Assert.Equal(1, handler.Requests);
    }

    private sealed class SequenceHandler(params HttpStatusCode[] statuses) : HttpMessageHandler
    {
        public int Requests { get; private set; }
        public List<string> Paths { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Paths.Add(request.RequestUri!.AbsolutePath);
            var status = statuses[Math.Min(Requests++, statuses.Length - 1)];
            return Task.FromResult(new HttpResponseMessage(status));
        }
    }
}
