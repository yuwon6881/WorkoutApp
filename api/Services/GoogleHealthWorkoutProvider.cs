using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Workout.Api.Services;

public sealed record GoogleHealthWorkoutDataPoint(
    string StartTime,
    string EndTime,
    string ExerciseDisplayName,
    string ActivityType,
    string Notes);

public sealed record GoogleHealthOperationResult(
    bool Done,
    bool Found = true,
    string? OperationName = null,
    string? ResourceName = null,
    string? ErrorCategory = null,
    string? ErrorMessage = null);

internal sealed class GoogleHealthWorkoutProviderException(
    string category,
    string message,
    bool transient = false,
    bool unknownCreate = false,
    TimeSpan? retryAfter = null,
    bool authenticationFailure = false) : Exception(message)
{
    public string Category { get; } = category;
    public bool Transient { get; } = transient;
    public bool UnknownCreate { get; } = unknownCreate;
    public TimeSpan? RetryAfter { get; } = retryAfter;
    public bool AuthenticationFailure { get; } = authenticationFailure;
}

internal static class GoogleHealthWorkoutProvider
{
    public static Task<GoogleHealthOperationResult> CreateAsync(HttpClient http, string token, GoogleHealthWorkoutDataPoint data, CancellationToken ct)
        => SendOperationAsync(http, HttpMethod.Post, "https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints", token, BuildPayload(data), true, ct);

    public static Task<GoogleHealthOperationResult> UpdateAsync(HttpClient http, string token, string resourceName, GoogleHealthWorkoutDataPoint data, CancellationToken ct)
        => SendOperationAsync(http, HttpMethod.Patch, ResourceUrl(resourceName), token, BuildPayload(data), false, ct);

    public static Task<GoogleHealthOperationResult> DeleteAsync(HttpClient http, string token, string resourceName, CancellationToken ct)
        => SendOperationAsync(http, HttpMethod.Post, "https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints:batchDelete", token, new { names = new[] { resourceName } }, false, ct, deleteRequest: true);

    public static Task<GoogleHealthOperationResult> PollAsync(HttpClient http, string token, string operationName, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, ResourceUrl(operationName));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return PollInternalAsync(http, request, operationName, ct);
    }

    private static async Task<GoogleHealthOperationResult> PollInternalAsync(HttpClient http, HttpRequestMessage request, string operationName, CancellationToken ct)
    {
        using var response = await SendAsync(http, request, false, ct);
        return await ParseOperationAsync(response, operationName, false, ct);
    }

    public static object BuildPayload(GoogleHealthWorkoutDataPoint data)
    {
        return new
        {
            exercise = new
            {
                interval = new
                {
                    startTime = data.StartTime,
                    endTime = data.EndTime
                },
                exerciseDisplayName = string.IsNullOrWhiteSpace(data.ExerciseDisplayName) ? "Workout" : data.ExerciseDisplayName.Trim(),
                activityType = string.IsNullOrWhiteSpace(data.ActivityType) ? "WEIGHTLIFTING" : data.ActivityType,
                notes = data.Notes ?? ""
            }
        };
    }

    private static async Task<GoogleHealthOperationResult> SendOperationAsync(HttpClient http, HttpMethod method, string url, string token, object body, bool create, CancellationToken ct, bool deleteRequest = false)
    {
        using var request = new HttpRequestMessage(method, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body, Json.Options), Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        try
        {
            using var response = await SendAsync(http, request, create, ct, deleteRequest);
            if (response.StatusCode == HttpStatusCode.NotFound && deleteRequest)
                return new(true, true);
            return await ParseOperationAsync(response, null, create, ct);
        }
        catch (GoogleHealthWorkoutProviderException)
        {
            throw;
        }
        catch (HttpRequestException) when (create)
        {
            throw new GoogleHealthWorkoutProviderException("upload_status_unknown", "The create response was lost; check Google Health before retrying.", unknownCreate: true);
        }
        catch (JsonException) when (create)
        {
            throw new GoogleHealthWorkoutProviderException("upload_status_unknown", "The create response was unreadable; check Google Health before retrying.", unknownCreate: true);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested && create)
        {
            throw new GoogleHealthWorkoutProviderException("upload_status_unknown", "The create response was lost; check Google Health before retrying.", unknownCreate: true);
        }
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient http, HttpRequestMessage request, bool create, CancellationToken ct, bool allowMissing = false)
    {
        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch (HttpRequestException ex)
        {
            if (create) throw;
            throw new GoogleHealthWorkoutProviderException("provider_unavailable", ex.Message, transient: true);
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            if (create) throw;
            throw new GoogleHealthWorkoutProviderException("provider_unavailable", ex.Message, transient: true);
        }

        if (response.IsSuccessStatusCode || (allowMissing && response.StatusCode == HttpStatusCode.NotFound))
            return response;

        var body = await response.Content.ReadAsStringAsync(ct);
        var (category, message) = ParseError(response.StatusCode, body);
        var retryAfter = response.Headers.RetryAfter?.Delta;
        response.Dispose();
        throw new GoogleHealthWorkoutProviderException(category, message,
            transient: response.StatusCode == HttpStatusCode.TooManyRequests || (int)response.StatusCode >= 500,
            retryAfter: retryAfter,
            authenticationFailure: response.StatusCode == HttpStatusCode.Unauthorized);
    }

    private static async Task<GoogleHealthOperationResult> ParseOperationAsync(HttpResponseMessage response, string? operationName, bool create, CancellationToken ct)
    {
        if (response.StatusCode == HttpStatusCode.NotFound)
            return new(true, false);

        var json = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (root.TryGetProperty("error", out var errorProp))
        {
            var code = errorProp.TryGetProperty("code", out var c) ? c.GetInt32() : (int)response.StatusCode;
            var message = errorProp.TryGetProperty("message", out var m) ? m.GetString() : "Google Health rejected the workout operation.";
            var (category, mappedMessage) = ParseError((HttpStatusCode)code, message);
            return new(true, true, ErrorCategory: category, ErrorMessage: mappedMessage);
        }

        var done = !root.TryGetProperty("done", out var doneProp) || doneProp.GetBoolean();
        var returnedOpName = root.TryGetProperty("name", out var nameProp) ? nameProp.GetString() : operationName;

        string? resourceName = null;
        if (root.TryGetProperty("response", out var respProp) && respProp.TryGetProperty("name", out var resNameProp))
            resourceName = resNameProp.GetString();
        else if (root.TryGetProperty("name", out var directName) && directName.GetString() is { } n && n.Contains("/dataPoints/"))
            resourceName = n;

        return new(done, true, returnedOpName, resourceName);
    }

    private static (string Category, string Message) ParseError(HttpStatusCode code, string? body)
    {
        var category = code switch
        {
            HttpStatusCode.Unauthorized => "reconnect_required",
            HttpStatusCode.Forbidden => "permission_missing",
            HttpStatusCode.NotFound => "provider_not_found",
            HttpStatusCode.TooManyRequests => "rate_limit_exceeded",
            HttpStatusCode.BadRequest => "provider_validation",
            _ when (int)code >= 500 => "provider_unavailable",
            _ => "provider_error"
        };
        var message = code switch
        {
            HttpStatusCode.Unauthorized => "Google Health requires you to reconnect before uploading workouts.",
            HttpStatusCode.Forbidden => "Google Health did not grant permission to upload workouts.",
            HttpStatusCode.NotFound => "The requested workout data point no longer exists in Google Health.",
            HttpStatusCode.TooManyRequests => "Google Health rate limit reached. Retry scheduled.",
            HttpStatusCode.BadRequest => "Google Health rejected the workout format.",
            _ when (int)code >= 500 => "Google Health is temporarily unavailable.",
            _ => "Google Health returned an unexpected error."
        };
        return (category, message);
    }

    private static string ResourceUrl(string resourceOrOperation)
    {
        if (resourceOrOperation.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            resourceOrOperation.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return resourceOrOperation;
        return $"https://health.googleapis.com/v4/{resourceOrOperation.TrimStart('/')}";
    }
}
