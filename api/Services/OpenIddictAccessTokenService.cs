using Microsoft.AspNetCore.Authentication;
using OpenIddict.Abstractions;
using OpenIddict.Validation.AspNetCore;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record ValidatedAccessToken(string Subject, string Issuer, IReadOnlySet<string> Scopes, DateTime ExpiresAt);

/// Uses OpenIddict's discovery/JWKS validation handler for resource requests. No application
/// code parses JWTs or loads a long-lived signing key.
public sealed class OpenIddictAccessTokenService
{
    public async Task<ValidatedAccessToken> Require(HttpContext context, string requiredScope, CancellationToken ct)
    {
        var result = await context.AuthenticateAsync(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme);
        Validation.Require(result.Succeeded && result.Principal is not null, "A shared access token is required.", 401);
        var principal = result.Principal!;
        var subject = principal.FindFirst(OpenIddictConstants.Claims.Subject)?.Value;
        Validation.Require(!string.IsNullOrWhiteSpace(subject), "The shared access token has no subject.", 403);
        var scopes = principal.GetScopes().ToHashSet(StringComparer.Ordinal);
        Validation.Require(scopes.Contains(requiredScope), "The shared access token does not grant this resource scope.", 403);
        var expiry = principal.GetExpirationDate();
        Validation.Require(expiry is { } && expiry > DateTimeOffset.UtcNow,
            "The shared access token has expired.", 401);
        return new(subject!, principal.FindFirst(OpenIddictConstants.Claims.Issuer)?.Value ?? "", scopes, expiry!.Value.UtcDateTime);
    }
}
