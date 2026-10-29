using System.Security.Cryptography;
using System.Text;
using Google.Apis.Auth;

namespace Workout.Api.Services;

/// Returns the verified email of a Google-signed OIDC identity token, or null when it is not valid.
public interface IMaintenanceTokenVerifier
{
    Task<string?> VerifiedEmail(string token, string audience, CancellationToken ct);
}

public sealed class GoogleMaintenanceTokenVerifier(ILogger<GoogleMaintenanceTokenVerifier> logger) : IMaintenanceTokenVerifier
{
    public async Task<string?> VerifiedEmail(string token, string audience, CancellationToken ct)
    {
        try
        {
            ct.ThrowIfCancellationRequested();
            var payload = await GoogleJsonWebSignature.ValidateAsync(token,
                new GoogleJsonWebSignature.ValidationSettings { Audience = [audience] });
            return payload.Issuer is "accounts.google.com" or "https://accounts.google.com" && payload.EmailVerified
                ? payload.Email
                : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogInformation("Rejected an invalid maintenance identity token ({ErrorType}).", ex.GetType().Name);
            return null;
        }
    }
}

/// Authenticates the `/internal` maintenance routes. This service is reachable without Cloud Run IAM,
/// so a caller must present a Google identity token whose audience is `Maintenance:Audience` and whose
/// email is in `Maintenance:AllowedCallers`. The legacy `X-Workout-Maintenance-Secret` header is honoured
/// only while `Maintenance:Secret` is configured, so removing that secret retires it. Missing
/// configuration rejects the call.
public sealed class MaintenanceGate(IConfiguration configuration, IMaintenanceTokenVerifier verifier)
{
    public async Task<bool> Allow(HttpRequest request, CancellationToken ct)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var audience = configuration["Maintenance:Audience"];
            var token = authorization["Bearer ".Length..].Trim();
            if (!string.IsNullOrWhiteSpace(audience) && token.Length is >= 1 and <= 16_384
                && await verifier.VerifiedEmail(token, audience, ct) is { } email
                && AllowedCallers().Contains(email, StringComparer.OrdinalIgnoreCase))
                return true;
        }

        var expected = configuration["Maintenance:Secret"]?.Trim() ?? "";
        var presented = request.Headers["X-Workout-Maintenance-Secret"].ToString();
        return !string.IsNullOrWhiteSpace(expected)
            && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(presented));
    }

    private string[] AllowedCallers() =>
        (configuration["Maintenance:AllowedCallers"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
