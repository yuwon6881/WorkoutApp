using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record GoogleHealthDay(DateOnly Date, int? Count);

public sealed record GoogleHealthSyncResult(
    string Status,
    DateTime? ConnectedAt,
    DateTime? LastSyncedAt,
    string Freshness,
    IReadOnlyList<GoogleHealthDay> Days,
    string? WarningCode = null,
    string? WarningMessage = null,
    GoogleHealthWorkoutSyncStatus? WorkoutSync = null
);

public sealed record GoogleHealthConnectResult(string AuthUrl);

public class GoogleHealthService(
    HttpClient http,
    AppDb db,
    IIntegrationKms kms,
    IConfiguration config,
    ILogger<GoogleHealthService>? logger = null)
{
    private static readonly ConcurrentDictionary<Guid, Task<GoogleHealthSyncResult>> InFlightSyncs = new();
    private static readonly MemoryCache SyncCache = new(new MemoryCacheOptions { SizeLimit = 512 });

    private sealed record CachedSync(DateTime SyncedAt, GoogleHealthSyncResult Result, long ConnectionGeneration);

    public static void InvalidateMemoryCache(Guid userId) => SyncCache.Remove(userId);
    public static void ClearMemoryCache() => SyncCache.Compact(1);

    public const string Scope = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";

    public string ClientId => (config["GoogleHealth:ClientId"] ?? config["GoogleHealthClientId"] ?? "").Trim();
    public string ClientSecret => (config["GoogleHealth:ClientSecret"] ?? config["GoogleHealthClientSecret"] ?? "").Trim();

    public string GetCallbackUrl(string? requestOrigin)
    {
        var origin = (config["PublicOrigin"] ?? requestOrigin ?? "").TrimEnd('/');
        Validation.Require(!string.IsNullOrEmpty(origin), "Server origin is not configured.", 500);
        return $"{origin}/api/integrations/google-health/callback";
    }

    public async Task<GoogleHealthConnectResult> GenerateConnectUrlAsync(
        Guid userId, string sessionHash, string? requestOrigin, CancellationToken ct,
        bool requestWorkoutSync = false)
    {
        Validation.Require(!string.IsNullOrEmpty(ClientId), "Google Health integration is not configured.", 503);

        var stateNonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var callbackUrl = GetCallbackUrl(requestOrigin);

        var operations = new List<string>();
        var scopes = new HashSet<string> { Scope };

        if (requestWorkoutSync)
        {
            operations.Add("workout_write");
            scopes.Add(GoogleHealthWorkoutSyncService.WorkoutScope);
        }

        var oauthState = new GoogleHealthOAuthState
        {
            State = stateNonce,
            UserId = userId,
            SessionHash = sessionHash,
            RequestedOperationsJson = JsonSerializer.Serialize(operations),
            RequestedScopesJson = JsonSerializer.Serialize(scopes),
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddMinutes(10)
        };

        db.GoogleHealthOAuthStates.Add(oauthState);
        await db.SaveChangesAsync(ct);

        var scopeString = "openid " + string.Join(" ", scopes);
        var query = new Dictionary<string, string>
        {
            ["client_id"] = ClientId,
            ["redirect_uri"] = callbackUrl,
            ["response_type"] = "code",
            ["scope"] = scopeString,
            ["access_type"] = "offline",
            ["prompt"] = "consent",
            ["state"] = stateNonce
        };

        var queryString = string.Join("&", query.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        var authUrl = $"https://accounts.google.com/o/oauth2/v2/auth?{queryString}";

        return new GoogleHealthConnectResult(authUrl);
    }

    public async Task<string> HandleCallbackAsync(string? code, string? state, string? error, Guid userId, string sessionHash, string? requestOrigin, CancellationToken ct)
    {
        var correlationId = Guid.NewGuid().ToString("N")[..12];
        string Failure(string failureCode, string stage)
        {
            logger?.LogWarning("Google Health OAuth failed at {Stage}; code {Code}; correlation {CorrelationId}.", stage, failureCode, correlationId);
            return $"/settings?google_health=error&code={Uri.EscapeDataString(failureCode)}";
        }

        if (!string.IsNullOrEmpty(error))
        {
            var providerCode = error.Length <= 64 && error.All(ch => char.IsLetterOrDigit(ch) || ch is '_' or '-')
                ? error
                : "provider_error";
            return Failure(providerCode, "provider");
        }

        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
            return Failure("missing_parameters", "callback_parameters");

        var oauthState = await db.GoogleHealthOAuthStates.IgnoreQueryFilters().SingleOrDefaultAsync(s => s.State == state, ct);
        if (oauthState == null || oauthState.ExpiresAt < DateTime.UtcNow)
        {
            if (oauthState != null)
            {
                db.GoogleHealthOAuthStates.Remove(oauthState);
                await db.SaveChangesAsync(ct);
            }
            return Failure("invalid_state", "state_lookup");
        }

        if (oauthState.UserId != userId || oauthState.SessionHash != sessionHash)
        {
            db.GoogleHealthOAuthStates.Remove(oauthState);
            await db.SaveChangesAsync(ct);
            return Failure("session_mismatch", "state_binding");
        }

        db.GoogleHealthOAuthStates.Remove(oauthState);
        await db.SaveChangesAsync(ct);

        var callbackUrl = GetCallbackUrl(requestOrigin);
        var tokenBody = new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = ClientId,
            ["client_secret"] = ClientSecret,
            ["redirect_uri"] = callbackUrl,
            ["grant_type"] = "authorization_code"
        };

        using var tokenReq = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
        {
            Content = new FormUrlEncodedContent(tokenBody)
        };

        HttpResponseMessage tokenRes;
        try
        {
            tokenRes = await http.SendAsync(tokenReq, ct);
        }
        catch
        {
            return Failure("token_exchange_failed", "token_exchange");
        }
        if (!tokenRes.IsSuccessStatusCode)
            return Failure("token_exchange_failed", "token_exchange");

        var tokenJson = await tokenRes.Content.ReadAsStringAsync(ct);
        JsonDocument tokenDoc;
        try
        {
            tokenDoc = JsonDocument.Parse(tokenJson);
        }
        catch
        {
            return Failure("token_exchange_failed", "token_response");
        }
        using (tokenDoc)
        {
            var root = tokenDoc.RootElement;
            var accessToken = root.TryGetProperty("access_token", out var atProp) ? atProp.GetString() : null;
            var refreshToken = root.TryGetProperty("refresh_token", out var rtProp) ? rtProp.GetString() : null;
            var returnedScopes = root.TryGetProperty("scope", out var scopeProp) && scopeProp.ValueKind == JsonValueKind.String
                ? scopeProp.GetString()?.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.Ordinal).ToArray()
                : null;

            if (string.IsNullOrEmpty(accessToken) || string.IsNullOrEmpty(refreshToken))
                return Failure("missing_tokens", "token_exchange");

            var googleId = await ResolveGoogleIdentityAsync(accessToken, ct);
            if (string.IsNullOrEmpty(googleId))
                return Failure("identity_resolution_failed", "identity_lookup");

            var googleIdHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(googleId))).ToLowerInvariant();

            var duplicate = await db.GoogleHealthConnections.IgnoreQueryFilters()
                .FirstOrDefaultAsync(c => c.GoogleIdHash == googleIdHash && c.UserId != userId, ct);
            if (duplicate != null)
                return Failure("duplicate_account", "account_binding");

            string encryptedGoogleId;
            string encryptedRefreshToken;
            try
            {
                encryptedGoogleId = await kms.EncryptAsync(googleId, ct);
                encryptedRefreshToken = await kms.EncryptAsync(refreshToken, ct);
            }
            catch
            {
                return Failure("encryption_failed", "kms_encryption");
            }

            var existingConn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
            if (existingConn != null && existingConn.GoogleIdHash != googleIdHash)
                return Failure("identity_change_requires_disconnect", "account_binding");

            string[]? requestedScopes = null;
            try { requestedScopes = JsonSerializer.Deserialize<string[]>(oauthState.RequestedScopesJson, Json.Options); }
            catch (JsonException) { requestedScopes = null; }

            string[]? storedScopes = null;
            if (existingConn != null && !string.IsNullOrWhiteSpace(existingConn.GrantedScopesJson))
                try { storedScopes = JsonSerializer.Deserialize<string[]>(existingConn.GrantedScopesJson, Json.Options); }
                catch (JsonException) { storedScopes = null; }

            var grantedScopes = returnedScopes
                ?? (requestedScopes is { Length: > 0 }
                    ? requestedScopes
                    : storedScopes is { Length: > 0 } ? storedScopes : new[] { Scope });

            var workoutGranted = grantedScopes.Contains(GoogleHealthWorkoutSyncService.WorkoutScope, StringComparer.Ordinal);

            if (existingConn != null)
            {
                existingConn.EncryptedGoogleId = encryptedGoogleId;
                existingConn.EncryptedRefreshToken = encryptedRefreshToken;
                existingConn.Status = "connected";
                existingConn.ConnectionGeneration++;
                existingConn.Revision++;
                existingConn.GrantedScopesJson = JsonSerializer.Serialize(grantedScopes);
                if (workoutGranted) existingConn.WorkoutSyncEnabled = true;
            }
            else
            {
                var newConn = new GoogleHealthConnection
                {
                    UserId = userId,
                    GoogleIdHash = googleIdHash,
                    EncryptedGoogleId = encryptedGoogleId,
                    EncryptedRefreshToken = encryptedRefreshToken,
                    EncryptedStepHistoryJson = await kms.EncryptAsync("[]", ct),
                    Status = "connected",
                    ConnectedAt = DateTime.UtcNow,
                    GrantedScopesJson = JsonSerializer.Serialize(grantedScopes),
                    WorkoutSyncEnabled = workoutGranted
                };
                db.GoogleHealthConnections.Add(newConn);
            }

            await db.SaveChangesAsync(ct);
            SyncCache.Remove(userId);
            return "/settings?google_health=connected";
        }
    }

    private async Task<string?> ResolveGoogleIdentityAsync(string accessToken, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, "https://www.googleapis.com/oauth2/v3/userinfo");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.TryGetProperty("sub", out var sub) ? sub.GetString() : null;
    }

    public async Task<string?> GetAccessTokenAsync(Guid userId, string requiredScope, CancellationToken ct)
    {
        var conn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (conn is null || conn.Status == "reconnect_required" || !HasGrantedScope(conn, requiredScope)) return null;

        return await RefreshAccessTokenAsync(conn, ct);
    }

    private async Task<string?> RefreshAccessTokenAsync(GoogleHealthConnection conn, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(conn.EncryptedRefreshToken)) return null;
        var refreshToken = await kms.DecryptAsync(conn.EncryptedRefreshToken, ct);
        if (string.IsNullOrEmpty(refreshToken)) return null;

        var form = new Dictionary<string, string>
        {
            ["client_id"] = ClientId,
            ["client_secret"] = ClientSecret,
            ["refresh_token"] = refreshToken,
            ["grant_type"] = "refresh_token"
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
        {
            Content = new FormUrlEncodedContent(form)
        };

        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            if (res.StatusCode == HttpStatusCode.BadRequest || res.StatusCode == HttpStatusCode.Unauthorized)
            {
                conn.Status = "reconnect_required";
                await db.SaveChangesAsync(ct);
            }
            return null;
        }

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.TryGetProperty("access_token", out var at) ? at.GetString() : null;
    }

    private static bool HasGrantedScope(GoogleHealthConnection connection, string requiredScope)
    {
        try
        {
            var scopes = JsonSerializer.Deserialize<string[]>(connection.GrantedScopesJson, Json.Options) ?? [];
            return scopes.Contains(requiredScope, StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public async Task<GoogleHealthSyncResult> DisconnectAsync(Guid userId, CancellationToken ct)
    {
        var conn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (conn == null)
            return new GoogleHealthSyncResult("disconnected", null, null, "unavailable", []);

        try
        {
            if (!string.IsNullOrEmpty(conn.EncryptedRefreshToken))
            {
                var refreshToken = await kms.DecryptAsync(conn.EncryptedRefreshToken, ct);
                if (!string.IsNullOrEmpty(refreshToken))
                {
                    using var revokeReq = new HttpRequestMessage(HttpMethod.Post, $"https://oauth2.googleapis.com/revoke?token={Uri.EscapeDataString(refreshToken)}");
                    await http.SendAsync(revokeReq, ct);
                }
            }
        }
        catch
        {
            // Best effort
        }

        await db.GoogleHealthWorkoutSyncWork
            .Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(ct);

        db.GoogleHealthConnections.Remove(conn);
        await db.SaveChangesAsync(ct);
        SyncCache.Remove(userId);

        return new GoogleHealthSyncResult("disconnected", null, null, "unavailable", []);
    }

    public async Task<GoogleHealthSyncResult> GetStatusAsync(Guid userId, CancellationToken ct)
    {
        var conn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (conn == null)
            return new GoogleHealthSyncResult("disconnected", null, null, "unavailable", []);

        var result = new GoogleHealthSyncResult(
            conn.Status,
            conn.ConnectedAt,
            conn.LastSyncedAt,
            "fresh",
            []);

        return await AttachSyncStatusesAsync(userId, result, ct);
    }

    public async Task<GoogleHealthSyncResult> AttachSyncStatusesAsync(Guid userId, GoogleHealthSyncResult result, CancellationToken ct)
    {
        var connection = await db.GoogleHealthConnections.AsNoTracking().SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (connection is null) return result;

        string[] granted = [];
        try { granted = JsonSerializer.Deserialize<string[]>(connection.GrantedScopesJson, Json.Options) ?? []; } catch (JsonException) { }

        var workoutWork = await db.GoogleHealthWorkoutSyncWork.AsNoTracking().Where(x => x.UserId == userId).ToListAsync(ct);
        var pending = workoutWork.Count(x => x.ProcessingState is "pending" or "processing" or "awaiting_operation");
        var problem = workoutWork.Where(x => x.ProcessingState is "failed" or "unknown").OrderByDescending(x => x.UpdatedAt).FirstOrDefault();

        var state = !connection.WorkoutSyncEnabled ? "disabled"
            : connection.Status == "reconnect_required" ? "reconnect_required"
            : problem?.ProcessingState ?? (pending > 0 ? "pending" : "idle");

        var workoutStatus = new GoogleHealthWorkoutSyncStatus(
            connection.WorkoutSyncEnabled,
            granted.Contains(GoogleHealthWorkoutSyncService.WorkoutScope, StringComparer.Ordinal),
            state,
            pending,
            connection.WorkoutLastSuccessfulSyncAt,
            connection.WorkoutSyncRevision,
            problem?.LastErrorCategory,
            problem?.LastErrorMessage);

        return result with { WorkoutSync = workoutStatus };
    }
}
