using System.Net;
using System.Text;
using System.Text.Json;
using Workout.Api.Data;

namespace Workout.Api.Services.RestAlerts;

/// <summary>Creates named, scheduled HTTP tasks. The database row remains the source of truth.</summary>
public sealed class CloudTasksRestAlertQueue(
    HttpClient http,
    IConfiguration configuration,
    IGoogleAccessTokenProvider tokens,
    ILogger<CloudTasksRestAlertQueue> logger) : IWorkoutRestTaskQueue
{
    private const string CloudTasksScope = "https://www.googleapis.com/auth/cloud-tasks";
    private string ProjectId => configuration["CloudTasks:ProjectId"] ?? "";
    private string Location => configuration["CloudTasks:Location"] ?? "";
    private string Queue => configuration["CloudTasks:Queue"] ?? "";
    private string TargetUrl => configuration["CloudTasks:TargetUrl"] ?? "";
    private string CallerServiceAccount => configuration["CloudTasks:CallerServiceAccountEmail"] ?? "";
    private string Audience => configuration["CloudTasks:Audience"] ?? "";

    public bool Configured => !string.IsNullOrWhiteSpace(ProjectId) && !string.IsNullOrWhiteSpace(Location) &&
        !string.IsNullOrWhiteSpace(Queue) && Uri.TryCreate(TargetUrl, UriKind.Absolute, out var target) && target.Scheme == Uri.UriSchemeHttps &&
        CallerServiceAccount.Contains('@', StringComparison.Ordinal) && !string.IsNullOrWhiteSpace(Audience);

    public string TaskName(Guid scheduleId)
        => $"projects/{ProjectId}/locations/{Location}/queues/{Queue}/tasks/rest-{scheduleId:N}";

    public async Task<bool> EnsureTaskAsync(WorkoutRestAlertSchedule schedule, CancellationToken ct)
    {
        if (!Configured) return false;
        string accessToken;
        try { accessToken = await tokens.GetAccessTokenAsync(CloudTasksScope, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not obtain runtime credentials for Workout rest-task scheduling.");
            return false;
        }

        var requestBody = JsonSerializer.Serialize(new { scheduleId = schedule.Id });
        var task = new
        {
            name = TaskName(schedule.Id),
            scheduleTime = schedule.Deadline.ToUniversalTime().ToString("O", System.Globalization.CultureInfo.InvariantCulture),
            httpRequest = new
            {
                httpMethod = "POST",
                url = TargetUrl,
                headers = new Dictionary<string, string> { ["Content-Type"] = "application/json" },
                body = Convert.ToBase64String(Encoding.UTF8.GetBytes(requestBody)),
                oidcToken = new { serviceAccountEmail = CallerServiceAccount, audience = Audience }
            }
        };

        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"https://cloudtasks.googleapis.com/v2/projects/{Uri.EscapeDataString(ProjectId)}/locations/{Uri.EscapeDataString(Location)}/queues/{Uri.EscapeDataString(Queue)}/tasks")
        { Content = JsonContent.Create(task) };
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            using var response = await http.SendAsync(request, ct);
            if (response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.Conflict) return true;
            logger.LogWarning("Workout rest-task creation failed with status {StatusCode}.", response.StatusCode);
            return false;
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Workout rest-task creation failed before a response was received.");
            return false;
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Workout rest-task creation timed out.");
            return false;
        }
    }

    public async Task<bool> DeleteTaskAsync(string taskName, CancellationToken ct)
    {
        if (!Configured || string.IsNullOrWhiteSpace(taskName)) return false;
        string accessToken;
        try { accessToken = await tokens.GetAccessTokenAsync(CloudTasksScope, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not obtain runtime credentials for Workout rest-task cancellation.");
            return false;
        }

        using var request = new HttpRequestMessage(HttpMethod.Delete,
            $"https://cloudtasks.googleapis.com/v2/{string.Join('/', taskName.Split('/').Select(Uri.EscapeDataString))}");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            using var response = await http.SendAsync(request, ct);
            return response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.NotFound;
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Workout rest-task cancellation failed before a response was received.");
            return false;
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Workout rest-task cancellation timed out.");
            return false;
        }
    }
}
