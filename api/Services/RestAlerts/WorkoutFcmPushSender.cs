using System.Net.Http.Headers;
using System.Text.Json;

namespace Workout.Api.Services.RestAlerts;

/// <summary>Sends private, data-only rest alerts through the FCM HTTP v1 API.</summary>
public sealed class WorkoutFcmPushSender(
    HttpClient http,
    IConfiguration configuration,
    IGoogleAccessTokenProvider tokens,
    ILogger<WorkoutFcmPushSender> logger) : IWorkoutPushSender
{
    private const string MessagingScope = "https://www.googleapis.com/auth/firebase.messaging";
    private string? ProjectId => configuration["Fcm:ProjectId"];
    public bool Configured => !string.IsNullOrWhiteSpace(ProjectId) && ProjectId != "__not_configured__";

    public async Task<WorkoutPushSendResult> SendAsync(string token, WorkoutPushContent content, CancellationToken ct)
    {
        if (!Configured) return new(WorkoutPushSendStatus.TransientFailure);
        string accessToken;
        try { accessToken = await tokens.GetAccessTokenAsync(MessagingScope, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not obtain runtime credentials for Workout push.");
            return new(WorkoutPushSendStatus.TransientFailure);
        }

        var payload = new
        {
            message = new
            {
                token,
                webpush = new
                {
                    headers = new Dictionary<string, string>
                    {
                        ["TTL"] = Math.Max(1, (long)content.TimeToLive.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture)
                    }
                },
                data = new Dictionary<string, string>
                {
                    ["kind"] = "workout-rest",
                    ["title"] = content.Title,
                    ["body"] = content.Body,
                    ["tag"] = content.Tag,
                    ["route"] = content.Route,
                    ["sessionId"] = content.SessionId,
                    ["generation"] = content.Generation
                }
            }
        };
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"https://fcm.googleapis.com/v1/projects/{Uri.EscapeDataString(ProjectId!)}/messages:send")
        {
            Content = JsonContent.Create(payload)
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        HttpResponseMessage response;
        try { response = await http.SendAsync(request, ct); }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Workout FCM send failed before a response was received.");
            return new(WorkoutPushSendStatus.TransientFailure);
        }

        using (response)
        {
            if (response.IsSuccessStatusCode) return new(WorkoutPushSendStatus.Accepted);
            var body = await response.Content.ReadAsStringAsync(ct);
            if (IsInvalidOrUnregistered(body)) return new(WorkoutPushSendStatus.InvalidOrUnregistered);
            logger.LogWarning("Workout FCM send failed with status {StatusCode}.", response.StatusCode);
            return new(WorkoutPushSendStatus.TransientFailure);
        }
    }

    internal static bool IsInvalidOrUnregistered(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            if (!document.RootElement.TryGetProperty("error", out var error) ||
                !error.TryGetProperty("details", out var details) || details.ValueKind != JsonValueKind.Array) return false;
            foreach (var detail in details.EnumerateArray())
            {
                if (!detail.TryGetProperty("@type", out var type) ||
                    type.GetString() is not string typeName ||
                    !typeName.EndsWith("google.firebase.fcm.v1.FcmError", StringComparison.Ordinal)) continue;
                if (detail.TryGetProperty("errorCode", out var code) &&
                    code.GetString() is string value && value.Equals("UNREGISTERED", StringComparison.OrdinalIgnoreCase)) return true;
            }
        }
        catch (JsonException)
        {
            // An unstructured response is retryable, not proof that the device token is stale.
        }
        return false;
    }
}
