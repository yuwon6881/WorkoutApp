using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Keeps peer refresh tokens backend-only. Access tokens are minted just in time, validated for
/// the peer audience, and never returned to the PWA.
public sealed class IntegrationTokenService(
    AppDb db,
    IHttpClientFactory clients,
    IConfiguration config,
    OpenIddictAccessTokenService tokens,
    IIntegrationKms kms)
{
    private static readonly SemaphoreSlim RotationGate = new(1, 1);

    public Task<string> Protect(string value, CancellationToken ct = default) => kms.EncryptAsync(value, ct);

    public async Task<string?> Unprotect(string encrypted, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(encrypted)) return null;
        try { return await kms.DecryptAsync(encrypted, ct); }
        catch (CryptographicException) { return null; }
        catch (FormatException) { return null; }
        catch (InvalidOperationException) { return null; }
        catch (DomainException) { return null; }
    }

    public async Task<string?> AccessToken(string peer, string requiredScope, CancellationToken ct)
    {
        await RotationGate.WaitAsync(ct);
        try
        {
            var grant = await db.IntegrationGrants.SingleOrDefaultAsync(x => x.Peer == peer && x.Status == "active", ct);
            var refresh = grant is null ? null : await Unprotect(grant.EncryptedRefreshToken, ct);
            if (string.IsNullOrWhiteSpace(refresh)) return null;
            var identitySubject = await db.Users.Where(x => x.Id == db.CurrentUser).Select(x => x.IdentitySubject).SingleOrDefaultAsync(ct);
            var settings = GetCentralClientSettings();
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.Authority.TrimEnd('/')}/connect/token");
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.ClientId}:{settings.ClientSecret}")));
            request.Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["refresh_token"] = refresh
            });
            using var response = await clients.CreateClient("fitness-account").SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                if (response.StatusCode == HttpStatusCode.BadRequest && grant is not null)
                {
                    grant.Status = "revoked";
                    grant.RevokedAt = DateTime.UtcNow;
                    grant.EncryptedRefreshToken = "";
                    grant.Revision++;
                    await db.SaveChangesAsync(ct);
                }
                return null;
            }
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var access = document.RootElement.TryGetProperty("access_token", out var accessElement) ? accessElement.GetString() : null;
            if (string.IsNullOrWhiteSpace(access)) return null;
            var validated = await tokens.RequireAccessToken(access, requiredScope, ct);
            Validation.Require(string.Equals(validated.Subject, identitySubject, StringComparison.Ordinal), "The peer token belongs to a different account.", 403);
            if (document.RootElement.TryGetProperty("refresh_token", out var nextRefresh) && !string.IsNullOrWhiteSpace(nextRefresh.GetString()))
            {
                grant!.EncryptedRefreshToken = await Protect(nextRefresh.GetString()!, ct);
                grant.Revision++;
                await db.SaveChangesAsync(ct);
            }
            return access;
        }
        catch (DomainException) { return null; }
        catch (HttpRequestException) { return null; }
        catch (JsonException) { return null; }
        finally { RotationGate.Release(); }
    }

    public async Task RevokeAndPurge(string peer, CancellationToken ct)
    {
        var grant = await db.IntegrationGrants.SingleOrDefaultAsync(x => x.Peer == peer, ct);
        if (grant is null) return;
        var refresh = await Unprotect(grant.EncryptedRefreshToken, ct);
        if (!string.IsNullOrWhiteSpace(refresh))
        {
            try
            {
                var settings = GetCentralClientSettings();
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.Authority.TrimEnd('/')}/connect/revocation");
                request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.ClientId}:{settings.ClientSecret}")));
                request.Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = refresh, ["token_type_hint"] = "refresh_token" });
                await clients.CreateClient("fitness-account").SendAsync(request, ct);
            }
            catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or DomainException) { /* local purge still stops all future exchange */ }
        }
        db.IntegrationGrants.Remove(grant);
        await db.SaveChangesAsync(ct);
    }

    private CentralClientSettings GetCentralClientSettings()
    {
        var authority = config["Identity:Authority"];
        var clientId = config["Identity:ClientId"];
        var clientSecret = config["Identity:ClientSecret"];
        Validation.Require(!string.IsNullOrWhiteSpace(authority) && !string.IsNullOrWhiteSpace(clientId) && !string.IsNullOrWhiteSpace(clientSecret), "Fitness Account integration is not configured.", 503);
        return new(authority!, clientId!, clientSecret!);
    }

    private sealed record CentralClientSettings(string Authority, string ClientId, string ClientSecret);
}
