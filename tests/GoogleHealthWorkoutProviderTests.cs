using System.Net;
using System.Text.Json;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class GoogleHealthWorkoutProviderTests
{
    [Fact]
    public async Task CreateUsesGoogleHealthWorkoutDataPointShape()
    {
        var handler = new CaptureHandler();
        using var http = new HttpClient(handler);

        var dataPoint = new GoogleHealthWorkoutDataPoint(
            "2026-09-20T09:00:00+08:00",
            "2026-09-20T10:15:00+08:00",
            "Upper Body Push",
            "WEIGHTLIFTING",
            "Bench Press: 3 sets (80kg x 8, 85kg x 6, 85kg x 6)\nTotal Volume: 1,660 kg | 3 completed sets");

        await GoogleHealthWorkoutProvider.CreateAsync(
            http,
            "access-token",
            dataPoint,
            default);

        using var body = JsonDocument.Parse(handler.Body!);
        var exercise = body.RootElement.GetProperty("exercise");
        Assert.Equal("2026-09-20T09:00:00+08:00", exercise.GetProperty("interval").GetProperty("startTime").GetString());
        Assert.Equal("2026-09-20T10:15:00+08:00", exercise.GetProperty("interval").GetProperty("endTime").GetString());
        Assert.Equal("Upper Body Push", exercise.GetProperty("exerciseDisplayName").GetString());
        Assert.Equal("WEIGHTLIFTING", exercise.GetProperty("activityType").GetString());
        Assert.Contains("Total Volume: 1,660 kg", exercise.GetProperty("notes").GetString());
    }

    [Fact]
    public async Task DeleteUsesBatchDeleteShape()
    {
        var handler = new CaptureHandler();
        using var http = new HttpClient(handler);

        await GoogleHealthWorkoutProvider.DeleteAsync(
            http,
            "access-token",
            "users/me/dataTypes/exercise/dataPoints/test-id",
            default);

        Assert.Equal("https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints:batchDelete", handler.RequestUrl);
        using var body = JsonDocument.Parse(handler.Body!);
        var names = body.RootElement.GetProperty("names").EnumerateArray().Select(x => x.GetString()).ToList();
        Assert.Contains("users/me/dataTypes/exercise/dataPoints/test-id", names);
    }

    private sealed class CaptureHandler : HttpMessageHandler
    {
        public string? Body { get; private set; }
        public string? RequestUrl { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUrl = request.RequestUri?.ToString();
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"name\":\"operations/test\",\"done\":false}")
            };
        }
    }
}
