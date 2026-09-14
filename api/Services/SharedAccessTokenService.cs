using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Validates the ID token returned by the central authorization-code flow through OIDC discovery.
/// Resource access tokens are validated by OpenIddictAccessTokenService; neither path accepts a
/// static HMAC key or a manually parsed JWT.
public sealed class SharedAccessTokenService(IConfiguration config)
{
    private readonly ConfigurationManager<OpenIdConnectConfiguration> configuration = new(
        MetadataAddress(config),
        new OpenIdConnectConfigurationRetriever(),
        new HttpDocumentRetriever { RequireHttps = true });

    public async Task<string> ValidateIdentityToken(string token, string nonce, string clientId, CancellationToken ct)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(token), "The central identity token is missing.", 401);
        OpenIdConnectConfiguration metadata;
        try { metadata = await configuration.GetConfigurationAsync(ct); }
        catch (Exception ex) when (ex is IOException or HttpRequestException or InvalidOperationException)
        { throw new DomainException("The central identity metadata is unavailable.", 503); }

        ClaimsPrincipal principal;
        try { principal = Validate(token, clientId, metadata); }
        catch (SecurityTokenSignatureKeyNotFoundException)
        {
            configuration.RequestRefresh();
            try { principal = Validate(token, clientId, await configuration.GetConfigurationAsync(ct)); }
            catch (Exception ex) when (ex is IOException or HttpRequestException or InvalidOperationException)
            { throw new DomainException("The central identity metadata is unavailable.", 503); }
            catch (SecurityTokenException) { throw new DomainException("The central identity token is invalid.", 401); }
        }
        catch (SecurityTokenException) { throw new DomainException("The central identity token is invalid.", 401); }
        var receivedNonce = principal.FindFirst("nonce")?.Value;
        Validation.Require(string.Equals(receivedNonce, nonce, StringComparison.Ordinal), "The central identity nonce did not match.", 401);
        var subject = principal.FindFirst("sub")?.Value;
        Validation.Require(!string.IsNullOrWhiteSpace(subject), "The central identity token has no subject.", 401);
        return subject!;
    }

    private static string MetadataAddress(IConfiguration config)
        => $"{(config["Identity:Authority"] ?? config["Identity:Issuer"] ?? "").TrimEnd('/')}/.well-known/openid-configuration";

    private static string Normalize(string? value) => (value ?? "").TrimEnd('/');

    private ClaimsPrincipal Validate(string token, string clientId, OpenIdConnectConfiguration metadata)
    {
        var parameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = metadata.SigningKeys,
            ValidateIssuer = true,
            IssuerValidator = (issuer, _, _) =>
            {
                Validation.Require(Normalize(issuer) == Normalize(config["Identity:Issuer"] ?? metadata.Issuer), "The central identity issuer is not trusted.", 401);
                return issuer;
            },
            ValidateAudience = true,
            ValidAudience = clientId,
            ValidateLifetime = true,
            RequireSignedTokens = true,
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            ClockSkew = TimeSpan.FromMinutes(1)
        };
        return new JwtSecurityTokenHandler().ValidateToken(token, parameters, out _);
    }
}
