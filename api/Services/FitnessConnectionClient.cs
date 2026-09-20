using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record FitnessConnectionTokenExchange(HttpStatusCode StatusCode, string? AccessToken, int? ExpiresIn);
public sealed record FitnessConnectionStatus(string Status, long Generation);

/// Server-to-server calls for durable Workout/Nutrition consent in FitnessAccount.
public sealed class FitnessConnectionClient(IHttpClientFactory clients, IConfiguration config)
{
    public async Task<FitnessConnectionTokenExchange> Exchange(Guid connectionId, CancellationToken ct)
    {
        using var request = CreateRequest(HttpMethod.Post, "/connect/token");
        request.Content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "fitness_connection",
            ["connection_id"] = connectionId.ToString("D")
        });

        using var response = await clients.CreateClient("fitness-account").SendAsync(request, ct);
        if (!response.IsSuccessStatusCode) return new(response.StatusCode, null, null);
        try
        {
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var root = document.RootElement;
            var accessToken = root.TryGetProperty("access_token", out var access) ? access.GetString() : null;
            var expiresIn = root.TryGetProperty("expires_in", out var expires) && expires.TryGetInt32(out var seconds) ? seconds : (int?)null;
            return new(response.StatusCode, accessToken, expiresIn);
        }
        catch (JsonException)
        {
            throw new DomainException("Fitness Account returned an unreadable connection token response.", 503);
        }
    }

    public async Task<FitnessConnectionStatus> GetStatus(Guid connectionId, CancellationToken ct)
    {
        using var request = CreateRequest(HttpMethod.Get, $"/internal/integrations/connections/{connectionId:D}");
        using var response = await clients.CreateClient("fitness-account").SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
            throw new DomainException("Fitness Account connection status is temporarily unavailable.", 503);
        try
        {
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var root = document.RootElement;
            var status = root.TryGetProperty("status", out var statusElement) ? statusElement.GetString() : null;
            var generation = root.TryGetProperty("generation", out var generationElement) && generationElement.TryGetInt64(out var value) ? value : -1;
            Validation.Require((status is "active" or "revoked" or "missing" or "account_disabled") && generation >= 0,
                "Fitness Account returned an invalid connection status.", 503);
            return new(status!, generation);
        }
        catch (JsonException)
        {
            throw new DomainException("Fitness Account returned an unreadable connection status.", 503);
        }
    }

    public async Task Revoke(Guid connectionId, CancellationToken ct)
    {
        using var request = CreateRequest(HttpMethod.Post, $"/internal/integrations/connections/{connectionId:D}/revoke");
        using var response = await clients.CreateClient("fitness-account").SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.NoContent) return;
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            var status = await GetStatus(connectionId, ct);
            if (status.Status is "missing" or "revoked") return;
        }
        throw new DomainException("Fitness Account could not confirm that Nutrition access was revoked. Try again.", 503);
    }

    public async Task RevokeLegacyRefreshToken(string refreshToken, CancellationToken ct)
    {
        using var request = CreateRequest(HttpMethod.Post, "/connect/revocation");
        request.Content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["token"] = refreshToken,
            ["token_type_hint"] = "refresh_token"
        });
        using var response = await clients.CreateClient("fitness-account").SendAsync(request, ct);
        if (response.StatusCode is HttpStatusCode.OK or HttpStatusCode.NoContent) return;
        throw new DomainException("Fitness Account could not confirm that the previous connection was revoked. Try again.", 503);
    }

    /// Checks every incoming shared-data request. A central outage fails the request closed.
    public async Task<bool> ValidateIncoming(Guid connectionId, long generation, CancellationToken ct)
    {
        using var request = CreateRequest(HttpMethod.Get,
            $"/internal/integrations/connections/{connectionId:D}/validate?generation={generation}");
        using var response = await clients.CreateClient("fitness-account").SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.Gone) return false;
        if (response.StatusCode != HttpStatusCode.OK)
            throw new DomainException("Fitness Account cannot verify this shared connection right now.", 503);
        try
        {
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var root = document.RootElement;
            var active = root.TryGetProperty("active", out var activeElement) && activeElement.ValueKind == JsonValueKind.True;
            var currentGeneration = root.TryGetProperty("generation", out var generationElement) && generationElement.TryGetInt64(out var value) ? value : -1;
            return active && currentGeneration == generation;
        }
        catch (JsonException)
        {
            throw new DomainException("Fitness Account returned an unreadable connection validation response.", 503);
        }
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string path)
    {
        var authority = config["Identity:Authority"]?.TrimEnd('/');
        var clientId = config["Identity:ClientId"];
        var clientSecret = config["Identity:ClientSecret"];
        Validation.Require(!string.IsNullOrWhiteSpace(authority) && !string.IsNullOrWhiteSpace(clientId) && !string.IsNullOrWhiteSpace(clientSecret),
            "Fitness Account integration is not configured.", 503);
        var request = new HttpRequestMessage(method, $"{authority}{path}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes($"{clientId}:{clientSecret}")));
        return request;
    }
}
