using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Google.Apis.Auth.OAuth2;

namespace Workout.Api.Services;

public interface IImportJobDispatcher
{
    Task Enqueue(Guid userId, Guid importId, CancellationToken ct);
}

/// Optional Cloud Tasks integration. The durable database worker remains the fallback when a
/// queue is not provisioned; a task delivery is safe to duplicate because chunk commits are
/// revision and account-lock guarded in ImportService.
public sealed class CloudTasksImportJobDispatcher(HttpClient http, IConfiguration config, ILogger<CloudTasksImportJobDispatcher> log)
    : IImportJobDispatcher
{
    private const string Scope = "https://www.googleapis.com/auth/cloud-platform";
    private readonly string queue = config["ImportWorker:Queue"]?.Trim() ?? "";
    private readonly string workerUrl = config["ImportWorker:Url"]?.Trim() ?? "";
    private readonly string project = config["ImportWorker:Project"]?.Trim() ??
        Environment.GetEnvironmentVariable("GOOGLE_CLOUD_PROJECT")?.Trim() ?? "";
    private readonly string location = config["ImportWorker:Location"]?.Trim() ?? "asia-southeast1";
    private readonly string serviceAccount = config["ImportWorker:ServiceAccount"]?.Trim() ?? "";
    private readonly string secret = config["ImportWorker:Secret"]?.Trim() ?? "";

    public async Task Enqueue(Guid userId, Guid importId, CancellationToken ct)
    {
        // A local/test install has no queue and must continue to work without Google credentials.
        if (string.IsNullOrWhiteSpace(queue) || string.IsNullOrWhiteSpace(workerUrl) ||
            string.IsNullOrWhiteSpace(project) || string.IsNullOrWhiteSpace(serviceAccount)) return;
        if (!Uri.TryCreate(workerUrl, UriKind.Absolute, out var target) || target.Scheme != Uri.UriSchemeHttps)
        {
            log.LogWarning("ImportWorker:Url is not an HTTPS URL; leaving the import for the polling worker.");
            return;
        }

        try
        {
            var credential = await GoogleCredential.GetApplicationDefaultAsync(ct);
            var scoped = credential.CreateScoped(Scope).UnderlyingCredential as ITokenAccess;
            if (scoped is null) { log.LogWarning("Application credentials cannot mint a Cloud Tasks token; leaving the import for polling."); return; }
            var token = await scoped.GetAccessTokenForRequestAsync(null, ct);
            var payload = Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new ImportTask(userId, importId)));
            var task = new
            {
                task = new
                {
                    httpRequest = new
                    {
                        httpMethod = "POST",
                        url = target.ToString(),
                        headers = WorkerHeaders(),
                        body = payload,
                        oidcToken = new { serviceAccountEmail = serviceAccount, audience = target.ToString() }
                    }
                }
            };
            using var request = new HttpRequestMessage(HttpMethod.Post,
                $"https://cloudtasks.googleapis.com/v2/projects/{Uri.EscapeDataString(project)}/locations/{Uri.EscapeDataString(location)}/queues/{Uri.EscapeDataString(queue)}/tasks");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Content = new StringContent(JsonSerializer.Serialize(task), Encoding.UTF8, "application/json");
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode)
                log.LogWarning("Cloud Tasks rejected import {ImportId} with {Status}; polling will continue.", importId, (int)response.StatusCode);
        }
        catch (OperationCanceledException) { log.LogWarning("Cloud Tasks timed out or was cancelled for import {ImportId}; polling will continue.", importId); }
        catch (Exception ex) { log.LogWarning(ex, "Cloud Tasks enqueue failed for import {ImportId}; polling will continue.", importId); }
    }

    private Dictionary<string, string> WorkerHeaders()
    {
        var headers = new Dictionary<string, string> { ["Content-Type"] = "application/json" };
        if (!string.IsNullOrWhiteSpace(secret)) headers["X-Workout-Worker-Secret"] = secret;
        return headers;
    }

    public sealed record ImportTask(Guid UserId, Guid ImportId);
}
