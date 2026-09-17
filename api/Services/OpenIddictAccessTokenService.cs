using OpenIddict.Abstractions;
using OpenIddict.Validation;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record ValidatedAccessToken(string Subject, string Issuer, IReadOnlySet<string> Scopes, DateTime ExpiresAt);

/// Uses OpenIddict's discovery/JWKS validation handler for resource requests. No application
/// code parses JWTs or loads a long-lived signing key.
public sealed class OpenIddictAccessTokenService(OpenIddictValidationService validation)
{
    public async Task<ValidatedAccessToken> Require(HttpContext context, string requiredScope, CancellationToken ct)
    {
        var authorization = context.Request.Headers.Authorization.ToString();
        Validation.Require(authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase), "A shared access token is required.", 401);
        return await RequireAccessToken(authorization[7..].Trim(), requiredScope, ct);
    }

    public async Task<ValidatedAccessToken> RequireAccessToken(string accessToken, string requiredScope, CancellationToken ct)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(accessToken), "A shared access token is required.", 401);
        System.Security.Claims.ClaimsPrincipal? principal;
        try { principal = await validation.ValidateAccessTokenAsync(accessToken, ct); }
        catch (OpenIddictExceptions.ProtocolException) { throw new DomainException("The shared access token could not be validated.", 401); }
        Validation.Require(principal is not null, "The shared access token could not be validated.", 401);
        var subject = principal!.FindFirst(OpenIddictConstants.Claims.Subject)?.Value;
        Validation.Require(!string.IsNullOrWhiteSpace(subject), "The shared access token has no subject.", 403);
        var scopes = principal.GetScopes().ToHashSet(StringComparer.Ordinal);
        Validation.Require(scopes.Contains(requiredScope), "The shared access token does not grant this resource scope.", 403);
        var expiry = principal.GetExpirationDate();
        Validation.Require(expiry is { } && expiry > DateTimeOffset.UtcNow,
            "The shared access token has expired.", 401);
        return new(subject!, principal.FindFirst(OpenIddictConstants.Claims.Issuer)?.Value ?? "", scopes, expiry!.Value.UtcDateTime);
    }
}
