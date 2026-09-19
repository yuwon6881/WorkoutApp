using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Net.Http;

namespace Workout.Api.Services;

/// Measures outbound provider work without recording URLs, query strings, user data, or tokens.
/// Hostnames are reduced to a small service vocabulary so the metrics remain useful and cheap.
public sealed class ExternalCallMetricsHandler : DelegatingHandler
{
    private static readonly Meter Meter = new("Fitness.Workout.External", "1.0");
    private static readonly Counter<long> RequestCount = Meter.CreateCounter<long>("external.request.count");
    private static readonly Histogram<double> RequestDuration = Meter.CreateHistogram<double>("external.request.duration", "ms");

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var started = Stopwatch.GetTimestamp();
        var service = Service(request.RequestUri?.Host);
        try
        {
            var response = await base.SendAsync(request, cancellationToken);
            Record(service, ((int)response.StatusCode).ToString(), response.IsSuccessStatusCode ? "success" : "http_error", started);
            return response;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            Record(service, "timeout", "timeout", started);
            throw;
        }
        catch
        {
            Record(service, "exception", "error", started);
            throw;
        }
    }

    private static void Record(string service, string status, string outcome, long started)
    {
        var tags = new TagList { { "service", service }, { "status", status }, { "outcome", outcome } };
        RequestCount.Add(1, tags);
        RequestDuration.Record(Stopwatch.GetElapsedTime(started).TotalMilliseconds, tags);
    }

    private static string Service(string? host)
    {
        if (string.IsNullOrWhiteSpace(host)) return "unknown";
        if (host.Contains("openai", StringComparison.OrdinalIgnoreCase)) return "openai";
        if (host.Contains("googleapis", StringComparison.OrdinalIgnoreCase) || host.Contains("google", StringComparison.OrdinalIgnoreCase)) return "google";
        if (host.Contains("fitness", StringComparison.OrdinalIgnoreCase)) return "fitness_account";
        if (host.Contains("nutrition", StringComparison.OrdinalIgnoreCase)) return "nutrition";
        return "other";
    }
}
