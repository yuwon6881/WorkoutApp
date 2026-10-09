using System.Net;

namespace Workout.Api.Services;

internal static class CentralIdentityReadiness
{
    // A direct browser redirect cannot recover when Cloud Run rejects the first cold request.
    // Probe the public health route until an instance is serving, then issue the OIDC redirect.
    internal static async Task<bool> WaitForReady(HttpClient client, string authority, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(25));
        var healthUrl = $"{authority.TrimEnd('/')}/health";

        for (var attempt = 0; attempt < 10; attempt++)
        {
            try
            {
                using var response = await client.GetAsync(healthUrl, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
                if (response.StatusCode == HttpStatusCode.OK) return true;
                if (response.StatusCode is not (HttpStatusCode.TooManyRequests or HttpStatusCode.RequestTimeout or
                    HttpStatusCode.InternalServerError or HttpStatusCode.BadGateway or
                    HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout))
                    return false;
            }
            catch (HttpRequestException) { }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                if (deadline.IsCancellationRequested) return false;
            }

            if (attempt == 9) break;
            var delay = TimeSpan.FromMilliseconds(Math.Min(250 * (1 << attempt), 3000));
            try { await Task.Delay(delay, deadline.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return false; }
        }

        ct.ThrowIfCancellationRequested();
        return false;
    }
}
