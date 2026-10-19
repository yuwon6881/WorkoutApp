using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;

namespace Workout.Api.Services;

public sealed record GoogleHealthHandoffResult(string Status, string? Code = null)
{
    public static readonly GoogleHealthHandoffResult Pending = new("pending");
    public static readonly GoogleHealthHandoffResult Connected = new("connected");
    public static GoogleHealthHandoffResult Failed(string code) => new("error", code);
}

/// Google refuses its consent screen inside an embedded WebView, so the Android app opens it in a
/// Custom Tab. That tab carries no Workout session, so its callback cannot be bound to one: it only
/// parks the authorization code on the state. The app that started the connection then finishes it
/// with its own session and a verifier it never sent anywhere but here, so a consent link that
/// reaches someone else cannot attach their Google account to this one, or this one to theirs.
public partial class GoogleHealthService
{
    public const string HandoffRedirect = "/open/settings?google_health=handoff";

    public static string HandoffHash(string verifier)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(verifier))).ToLowerInvariant();

    /// The callback's part of a handoff: null when the state is not a handoff, so the caller keeps the
    /// session-bound path; otherwise where to send the browser, which opens the app.
    public async Task<string?> DeferHandoffAsync(string? code, string? state, string? error, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(state)) return null;
        var oauthState = await db.GoogleHealthOAuthStates.IgnoreQueryFilters().SingleOrDefaultAsync(s => s.State == state, ct);
        if (oauthState?.HandoffVerifierHash == null) return null;
        if (oauthState.ExpiresAt < DateTime.UtcNow) return "/open/settings?google_health=error&code=invalid_state";
        // A repeated callback (a reload of the tab) never replaces the result already parked.
        if (oauthState.PendingCode != null || oauthState.PendingError != null) return HandoffRedirect;

        // No session exists in the browser tab; the state itself names its owner, and only its row is written.
        db.CurrentUser = oauthState.UserId;
        if (!string.IsNullOrEmpty(error))
            oauthState.PendingError = error.Length <= 64 && error.All(ch => char.IsLetterOrDigit(ch) || ch is '_' or '-') ? error : "provider_error";
        else if (string.IsNullOrEmpty(code))
            oauthState.PendingError = "missing_parameters";
        else
        {
            try { oauthState.PendingCode = await kms.EncryptAsync(code, ct); }
            catch { oauthState.PendingError = "encryption_failed"; }
        }
        await db.SaveChangesAsync(ct);
        return HandoffRedirect;
    }

    /// The app's part of a handoff, under its own session. Pending until the browser has returned.
    public async Task<GoogleHealthHandoffResult> CompleteHandoffAsync(
        Guid userId, string sessionHash, string state, string verifier, string? requestOrigin, CancellationToken ct)
    {
        var oauthState = await db.GoogleHealthOAuthStates.IgnoreQueryFilters().SingleOrDefaultAsync(s => s.State == state, ct);
        // A wrong verifier, user, or session leaves the state alone so the starting app can still finish it.
        if (oauthState?.HandoffVerifierHash == null || oauthState.ExpiresAt < DateTime.UtcNow
            || oauthState.UserId != userId || oauthState.SessionHash != sessionHash
            || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(oauthState.HandoffVerifierHash), Encoding.ASCII.GetBytes(HandoffHash(verifier))))
            return GoogleHealthHandoffResult.Failed("invalid_state");

        if (oauthState.PendingError != null)
        {
            db.GoogleHealthOAuthStates.Remove(oauthState);
            await db.SaveChangesAsync(ct);
            return GoogleHealthHandoffResult.Failed(oauthState.PendingError);
        }
        if (oauthState.PendingCode == null) return GoogleHealthHandoffResult.Pending;

        string code;
        try { code = await kms.DecryptAsync(oauthState.PendingCode, ct); }
        catch { return GoogleHealthHandoffResult.Failed("encryption_failed"); }

        // The ordinary exchange re-checks the state's binding and consumes it.
        var redirect = await HandleCallbackAsync(code, state, null, userId, sessionHash, requestOrigin, ct);
        var query = new Uri("https://local" + redirect).Query.TrimStart('?').Split('&')
            .Select(part => part.Split('=', 2))
            .Where(pair => pair.Length == 2)
            .ToDictionary(pair => pair[0], pair => Uri.UnescapeDataString(pair[1]));
        return query.GetValueOrDefault("google_health") == "connected"
            ? GoogleHealthHandoffResult.Connected
            : GoogleHealthHandoffResult.Failed(query.GetValueOrDefault("code") ?? "provider_error");
    }
}
