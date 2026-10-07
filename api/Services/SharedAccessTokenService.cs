using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record ValidatedIdentity(string Subject, string? Name);

/// Validates the ID token returned by the central authorization-code flow through OIDC discovery.
/// Resource access tokens are validated by OpenIddictAccessTokenService; neither path accepts a
/// static HMAC key or a manually parsed JWT.
public sealed class SharedAccessTokenService(IConfiguration config) : IAccountDeletionNoticeValidator
{
    private readonly ConfigurationManager<OpenIdConnectConfiguration> configuration = new(
        MetadataAddress(config),
        new OpenIdConnectConfigurationRetriever(),
        new HttpDocumentRetriever { RequireHttps = config.GetValue("Identity:RequireHttpsMetadata", true) });

    public async Task<ValidatedIdentity> ValidateIdentityToken(string token, string nonce, string clientId, CancellationToken ct)
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
        var name = principal.FindFirst("name")?.Value ?? principal.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value;
        return new ValidatedIdentity(subject!, name);
    }

    /// Validates the Fitness Account's signed notice that a central account was deleted and returns
    /// its subject. The dedicated token type and event claim, and the absence of a nonce, keep an
    /// identity or access token from ever being replayed as an erasure order.
    public async Task<string> ValidateAccountDeletionToken(string token, string clientId, CancellationToken ct)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(token), "The account deletion notice is missing.", 400);
        OpenIdConnectConfiguration metadata;
        try { metadata = await configuration.GetConfigurationAsync(ct); }
        catch (Exception ex) when (ex is IOException or HttpRequestException or InvalidOperationException)
        { throw new DomainException("The central identity metadata is unavailable.", 503); }
        var issuer = config["Identity:Issuer"] ?? metadata.Issuer;
        try { return ReadAccountDeletionSubject(token, clientId, issuer, metadata.SigningKeys); }
        catch (SecurityTokenSignatureKeyNotFoundException)
        {
            configuration.RequestRefresh();
            try { return ReadAccountDeletionSubject(token, clientId, issuer, (await configuration.GetConfigurationAsync(ct)).SigningKeys); }
            catch (Exception ex) when (ex is IOException or HttpRequestException or InvalidOperationException)
            { throw new DomainException("The central identity metadata is unavailable.", 503); }
            catch (SecurityTokenException) { throw new DomainException("The account deletion notice is invalid.", 401); }
        }
        catch (SecurityTokenException) { throw new DomainException("The account deletion notice is invalid.", 401); }
    }

    public Task<string> ValidateAsync(string token, CancellationToken ct)
    {
        var clientId = config["Identity:ClientId"];
        Validation.Require(!string.IsNullOrWhiteSpace(clientId), "Central Fitness Account sign-in is not configured.", 503);
        return ValidateAccountDeletionToken(token, clientId!, ct);
    }

    public const string AccountDeletionTokenType = "account-deletion+jwt";
    public const string AccountDeletionEvent = "urn:fitness-account:event:account-deleted";

    internal static string ReadAccountDeletionSubject(string token, string clientId, string? issuer, IEnumerable<SecurityKey> keys)
    {
        var parameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = keys,
            ValidateIssuer = true,
            IssuerValidator = (received, _, _) => Normalize(received) == Normalize(issuer) && !string.IsNullOrWhiteSpace(issuer)
                ? received
                : throw new SecurityTokenInvalidIssuerException("The account deletion notice issuer is not trusted."),
            ValidateAudience = true,
            ValidAudience = clientId,
            ValidateLifetime = true,
            RequireExpirationTime = true,
            RequireSignedTokens = true,
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            ValidTypes = [AccountDeletionTokenType],
            ClockSkew = TimeSpan.FromMinutes(1)
        };
        var principal = new JwtSecurityTokenHandler { MapInboundClaims = false }.ValidateToken(token, parameters, out var validated);
        var jwt = (JwtSecurityToken)validated;
        if (jwt.Payload.ContainsKey("nonce"))
            throw new SecurityTokenValidationException("An account deletion notice must not carry a nonce.");
        if (!jwt.Payload.TryGetValue("events", out var events) || !System.Text.Json.JsonSerializer.Serialize(events).Contains($"\"{AccountDeletionEvent}\"", StringComparison.Ordinal))
            throw new SecurityTokenValidationException("The token is not an account deletion notice.");
        var subject = principal.FindFirst("sub")?.Value;
        if (string.IsNullOrWhiteSpace(subject))
            throw new SecurityTokenValidationException("The account deletion notice has no subject.");
        return subject;
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
        return new JwtSecurityTokenHandler { MapInboundClaims = false }.ValidateToken(token, parameters, out _);
    }
}
