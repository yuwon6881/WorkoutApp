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
            "2026-09-20T01:00:00Z",
            "28800s",
            "2026-09-20T02:15:00Z",
            "28800s",
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
        var interval = exercise.GetProperty("interval");
        Assert.Equal("2026-09-20T01:00:00Z", interval.GetProperty("startTime").GetString());
        Assert.Equal("28800s", interval.GetProperty("startUtcOffset").GetString());
        Assert.Equal("2026-09-20T02:15:00Z", interval.GetProperty("endTime").GetString());
        Assert.Equal("28800s", interval.GetProperty("endUtcOffset").GetString());
        Assert.Equal("Upper Body Push", exercise.GetProperty("displayName").GetString());
        Assert.Equal("WEIGHTLIFTING", exercise.GetProperty("exerciseType").GetString());
        Assert.Equal(JsonValueKind.Object, exercise.GetProperty("metricsSummary").ValueKind);
        Assert.False(exercise.TryGetProperty("activityType", out _));
        Assert.Contains("Total Volume: 1,660 kg", exercise.GetProperty("notes").GetString());
    }

    [Fact]
    public async Task RejectedWorkoutKeepsGoogleReasonInTheMessage()
    {
        using var http = new HttpClient(new RejectingHandler(
            "{\"error\":{\"code\":400,\"message\":\"Invalid value at 'exercise.exercise_type'.\",\"status\":\"INVALID_ARGUMENT\"}}"));
        var dataPoint = new GoogleHealthWorkoutDataPoint(
            "2026-09-20T01:00:00Z", "0s", "2026-09-20T02:00:00Z", "0s", "Push", "WEIGHTLIFTING", "");

        var failure = await Assert.ThrowsAsync<GoogleHealthWorkoutProviderException>(
            () => GoogleHealthWorkoutProvider.CreateAsync(http, "access-token", dataPoint, default));

        Assert.Equal("provider_validation", failure.Category);
        Assert.False(failure.Transient);
        Assert.Contains("Invalid value at 'exercise.exercise_type'.", failure.Message);
    }

    [Fact]
    public async Task RejectedWorkoutWithoutBodyFallsBackToGenericMessage()
    {
        using var http = new HttpClient(new RejectingHandler(""));
        var dataPoint = new GoogleHealthWorkoutDataPoint(
            "2026-09-20T01:00:00Z", "0s", "2026-09-20T02:00:00Z", "0s", "Push", "WEIGHTLIFTING", "");

        var failure = await Assert.ThrowsAsync<GoogleHealthWorkoutProviderException>(
            () => GoogleHealthWorkoutProvider.CreateAsync(http, "access-token", dataPoint, default));

        Assert.Equal("Google Health rejected the workout format.", failure.Message);
    }

    private sealed class RejectingHandler(string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest) { Content = new StringContent(body) });
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
