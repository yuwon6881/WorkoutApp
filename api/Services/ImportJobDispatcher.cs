using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Google.Apis.Auth.OAuth2;

namespace Workout.Api.Services;

public interface IImportJobDispatcher
{
    /// Enqueues one expected extraction chunk. Implementations return false when delivery was not
    /// accepted, leaving the import's durable pending marker for the maintenance recovery pass.
    Task<bool> Enqueue(Guid userId, Guid importId, int expectedChunk, CancellationToken ct);
}

/// Cloud Tasks integration. Task names are deterministic per import/chunk, so maintenance can
/// safely retry an enqueue while a previous delivery is still in flight.
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

    public async Task<bool> Enqueue(Guid userId, Guid importId, int expectedChunk, CancellationToken ct)
    {
        // A local/test install has no queue and must continue to work without Google credentials.
        if (string.IsNullOrWhiteSpace(queue) || string.IsNullOrWhiteSpace(workerUrl) ||
            string.IsNullOrWhiteSpace(project) || string.IsNullOrWhiteSpace(serviceAccount)) return false;
        if (!Uri.TryCreate(workerUrl, UriKind.Absolute, out var target) || target.Scheme != Uri.UriSchemeHttps)
        {
            log.LogWarning("ImportWorker:Url is not an HTTPS URL; leaving the import for maintenance recovery.");
            return false;
        }

        try
        {
            var credential = await GoogleCredential.GetApplicationDefaultAsync(ct);
            var scoped = credential.CreateScoped(Scope).UnderlyingCredential as ITokenAccess;
            if (scoped is null) { log.LogWarning("Application credentials cannot mint a Cloud Tasks token; leaving the import for maintenance recovery."); return false; }
            var token = await scoped.GetAccessTokenForRequestAsync(null, ct);
            var payload = Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new ImportTask(userId, importId, expectedChunk)));
            var taskName = $"projects/{project}/locations/{location}/queues/{queue}/tasks/import-{importId:N}-chunk-{expectedChunk}";
            var task = new
            {
                task = new
                {
                    name = taskName,
                    // HTTP task delivery is capped at 30 minutes. The handler cancels at 25
                    // minutes so a retry can start before Cloud Tasks reaches its deadline.
                    dispatchDeadline = "1800s",
                    httpRequest = new
                    {
                        httpMethod = "POST",
                        url = target.ToString(),
                        headers = WorkerHeaders(),
                        body = payload,
                        // Cloud Run validates the service URL as the OIDC audience; the path remains
                        // the task target and is deliberately excluded from the audience value.
                        oidcToken = new { serviceAccountEmail = serviceAccount, audience = target.GetLeftPart(UriPartial.Authority) }
                    }
                }
            };
            using var request = new HttpRequestMessage(HttpMethod.Post,
                $"https://cloudtasks.googleapis.com/v2/projects/{Uri.EscapeDataString(project)}/locations/{Uri.EscapeDataString(location)}/queues/{Uri.EscapeDataString(queue)}/tasks");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Content = new StringContent(JsonSerializer.Serialize(task), Encoding.UTF8, "application/json");
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (response.IsSuccessStatusCode || (int)response.StatusCode == 409) return true;
            if (!response.IsSuccessStatusCode)
                log.LogWarning("Cloud Tasks rejected import {ImportId} with {Status}; maintenance will retry.", importId, (int)response.StatusCode);
            return false;
        }
        catch (OperationCanceledException) { log.LogWarning("Cloud Tasks timed out or was cancelled for import {ImportId}; maintenance will retry.", importId); return false; }
        catch (Exception ex) { log.LogWarning(ex, "Cloud Tasks enqueue failed for import {ImportId}; maintenance will retry.", importId); return false; }
    }

    private Dictionary<string, string> WorkerHeaders()
    {
        var headers = new Dictionary<string, string> { ["Content-Type"] = "application/json" };
        if (!string.IsNullOrWhiteSpace(secret)) headers["X-Workout-Worker-Secret"] = secret;
        return headers;
    }

    public sealed record ImportTask(Guid UserId, Guid ImportId, int ExpectedChunk);
}
