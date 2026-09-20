using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class CentralAuthEndpoints
{
    private const string StateCookie = "workout-oidc-state";
    private const string ConnectStateCookie = "workout-oidc-connect-state";
    private const string IdentityScope = "openid profile";
    private const string IntegrationScope = "openid profile nutrition.training_context.read";
    private const string NutritionScope = "nutrition.training_context.read";

    public static void MapCentralAuth(this WebApplication app)
    {
        app.MapGet("/api/auth/central/start", (HttpResponse response, IConfiguration config, [FromServices] IDataProtectionProvider protection, IHostEnvironment environment) =>
        {
            var settings = Settings(config, environment);
            var state = NewState(settings.ReturnUrl, false, null);
            var protector = protection.CreateProtector("workout-fitness-account-oidc-state-v1");
            response.Cookies.Append(StateCookie, protector.Protect(JsonSerializer.Serialize(state)), CookieOptions(environment, TimeSpan.FromMinutes(10)));
            return Results.Redirect(AuthorizeUrl(settings, state, IdentityScope));
        });

        // Consent is a separate backend flow. Shared login above requests identity claims only.
        app.MapGet("/api/auth/central/connect", async (HttpResponse response, IConfiguration config, [FromServices] IDataProtectionProvider protection,
            IHostEnvironment environment, AppDb db, IntegrationTokenService peerTokens, CancellationToken ct) =>
        {
            Validation.Require(db.CurrentUser is not null, "Sign in before connecting Nutrition.", 401);
            var localUser = db.CurrentUser!.Value;
            var settings = Settings(config, environment);
            var revision = await peerTokens.BeginConnectionAttempt(ct);
            var state = NewState(settings.ConnectReturnUrl, true, localUser, revision);
            var protector = protection.CreateProtector("workout-fitness-account-oidc-connect-v1");
            response.Cookies.Append(ConnectStateCookie, protector.Protect(JsonSerializer.Serialize(state)), CookieOptions(environment, TimeSpan.FromMinutes(10)));
            return Results.Redirect(AuthorizeUrl(settings, state, IntegrationScope));
        });

        app.MapGet("/api/auth/central/callback", async (HttpRequest request, HttpResponse response, [FromServices] IDataProtectionProvider protection,
            IHttpClientFactory clients, SharedAccessTokenService tokens, OpenIddictAccessTokenService accessTokens,
            IntegrationTokenService peerTokens, AuthService auth, AppDb db,
            IConfiguration config, IHostEnvironment environment, CancellationToken ct) =>
        {
            var (state, connect) = ReadState(request, protection);
            response.Cookies.Delete(connect ? ConnectStateCookie : StateCookie, CookieOptions(environment, TimeSpan.Zero));
            Validation.Require(FixedEquals(state.State, request.Query["state"]), "The central sign-in state did not match.", 400);
            var error = request.Query["error"]
                .SelectMany(value => (value ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries))
                .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
            if (!string.IsNullOrWhiteSpace(error))
                return Results.Redirect(AppendError(state.ReturnUrl, error));
            var code = request.Query["code"].ToString();
            Validation.Require(!string.IsNullOrWhiteSpace(code), "The central sign-in did not return an authorization code.", 400);
            var settings = Settings(config, environment);
            var payload = await Exchange(code, state, settings, clients, ct);
            var idToken = payload.TryGetProperty("id_token", out var identity) ? identity.GetString() : null;
            Validation.Require(!string.IsNullOrWhiteSpace(idToken), "The central sign-in returned no identity token.", 401);
            var validatedIdentity = await tokens.ValidateIdentityToken(idToken!, state.Nonce, settings.ClientId, ct);
            var identitySubject = validatedIdentity.Subject;
            var identityName = validatedIdentity.Name;
            ValidatedAccessToken? connectionToken = null;
            if (connect)
            {
                var accessToken = payload.TryGetProperty("access_token", out var access) ? access.GetString() : null;
                Validation.Require(!string.IsNullOrWhiteSpace(accessToken), "The central connection returned no access token.", 401);
                connectionToken = await accessTokens.RequireAccessToken(accessToken!, NutritionScope, ct);
                Validation.Require(identitySubject == connectionToken.Subject, "The central identity subject did not match the access token.", 401);
                Validation.Require(connectionToken.FitnessConnectionId is not null && connectionToken.FitnessConnectionGeneration is not null,
                    "The central connection did not return durable consent details.", 401);
            }

            if (connect)
            {
                var local = await LocalUser(request, db, state.LocalUserId, ct);
                Validation.Require(local is not null && local.IdentitySubject == identitySubject,
                    "This central subject is not attached to the current Workout account.", 403);
                db.CurrentUser = local!.Id;
                if (state.ConnectionRevision is not { } expectedRevision
                    || !await peerTokens.StoreDurableConnection(local.Id, connectionToken!.FitnessConnectionId!.Value,
                        connectionToken.FitnessConnectionGeneration!.Value, NutritionScope, expectedRevision, ct))
                    return Results.Redirect(AppendError(state.ReturnUrl, "connection_changed"));
                return Results.Redirect(state.ReturnUrl);
            }

            var user = await ProvisionOrGetUser(db, config, identitySubject, identityName, ct);

            var session = await auth.CreateSession(user.Id, ct);
            SetSessionCookie(response, session, environment, AuthService.Cookie);
            return Results.Redirect(state.ReturnUrl);
        });
    }

    private static LoginState NewState(string returnUrl, bool connect, Guid? localUserId, int? connectionRevision = null)
        => new(RandomString(32), RandomString(32), RandomString(64), returnUrl, connect, localUserId, connectionRevision);

    private static string AuthorizeUrl(OidcSettings settings, LoginState state, string scope)
    {
        var challenge = Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(state.Verifier)))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        var query = string.Join('&', $"response_type=code", $"client_id={Uri.EscapeDataString(settings.ClientId)}",
            $"redirect_uri={Uri.EscapeDataString(settings.RedirectUri)}", $"scope={Uri.EscapeDataString(scope)}",
            $"state={Uri.EscapeDataString(state.State)}", $"nonce={Uri.EscapeDataString(state.Nonce)}",
            $"code_challenge={Uri.EscapeDataString(challenge)}", "code_challenge_method=S256",
            state.Connect ? "prompt=consent" : "");
        return $"{settings.Authority.TrimEnd('/')}/connect/authorize?{query}";
    }

    private static async Task<JsonElement> Exchange(string code, LoginState state, OidcSettings settings, IHttpClientFactory clients, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.Authority.TrimEnd('/')}/connect/token");
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.ClientId}:{settings.ClientSecret}")));
        request.Content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code", ["code"] = code, ["redirect_uri"] = settings.RedirectUri,
            ["code_verifier"] = state.Verifier
        });
        var response = await clients.CreateClient("fitness-account").SendAsync(request, ct);
        Validation.Require(response.IsSuccessStatusCode, "The central sign-in could not be completed.", 401);
        return await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
    }

    private static (LoginState State, bool Connect) ReadState(HttpRequest request, IDataProtectionProvider protection)
    {
        var connectCookie = request.Cookies[ConnectStateCookie];
        var loginCookie = request.Cookies[StateCookie];
        try
        {
            if (!string.IsNullOrWhiteSpace(connectCookie))
            {
                var protector = protection.CreateProtector("workout-fitness-account-oidc-connect-v1");
                return (JsonSerializer.Deserialize<LoginState>(protector.Unprotect(connectCookie)) ?? throw new InvalidOperationException(), true);
            }
            Validation.Require(!string.IsNullOrWhiteSpace(loginCookie), "The central sign-in state is invalid or expired.", 400);
            var loginProtector = protection.CreateProtector("workout-fitness-account-oidc-state-v1");
            return (JsonSerializer.Deserialize<LoginState>(loginProtector.Unprotect(loginCookie!)) ?? throw new InvalidOperationException(), false);
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException or InvalidOperationException or FormatException)
        { throw new DomainException("The central sign-in state is invalid or expired.", 400); }
    }

    private static async Task<AppUser?> LocalUser(HttpRequest request, AppDb db, Guid? expected, CancellationToken ct)
    {
        if (expected is not { } expectedUser || string.IsNullOrWhiteSpace(request.Cookies[AuthService.Cookie])) return null;
        var hash = AuthService.Hash(request.Cookies[AuthService.Cookie]!);
        var session = await db.Sessions.AsNoTracking().SingleOrDefaultAsync(x => x.Hash == hash && x.Expires > DateTime.UtcNow, ct);
        return session?.UserId == expectedUser ? await db.Users.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.Id == expectedUser, ct) : null;
    }

    internal static async Task<AppUser> ProvisionOrGetUser(AppDb db, IConfiguration config, string identitySubject, string? identityName, CancellationToken ct)
    {
        var trimmedName = NormalizeDisplayName(identityName);
        var user = await db.Users.IgnoreQueryFilters().SingleOrDefaultAsync(item => item.IdentitySubject == identitySubject, ct);
        if (user is null)
        {
            var maxUsers = config.GetValue("Auth:MaxUsers", 2);
            var count = await db.Users.IgnoreQueryFilters().CountAsync(ct);
            Validation.Require(count < maxUsers, "Registration is closed: the maximum number of accounts has been reached.", 403);
            user = new AppUser
            {
                Id = Guid.NewGuid(),
                IdentitySubject = identitySubject,
                DisplayName = trimmedName
            };
            db.Users.Add(user);
            await db.SaveChangesAsync(ct);
        }
        else if (!string.IsNullOrWhiteSpace(identityName) && user.DisplayName != trimmedName)
        {
            user.DisplayName = trimmedName;
            await db.SaveChangesAsync(ct);
        }

        return user;
    }

    private static string NormalizeDisplayName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "User";
        var trimmed = name.Trim();
        return trimmed.Length > 120 ? trimmed[..120] : trimmed;
    }

    internal static OidcSettings Settings(IConfiguration config, IHostEnvironment environment)
    {
        var authority = config["Identity:Authority"];
        var clientId = config["Identity:ClientId"];
        var clientSecret = config["Identity:ClientSecret"];
        var redirect = config["Identity:RedirectUri"];
        var returnUrl = config["Identity:ReturnUrl"] ?? "/";
        var connectReturnUrl = config["Identity:ConnectReturnUrl"] ?? returnUrl;
        Validation.Require(Uri.TryCreate(authority, UriKind.Absolute, out _) && !string.IsNullOrWhiteSpace(clientId) &&
            !string.IsNullOrWhiteSpace(clientSecret) && Uri.TryCreate(redirect, UriKind.Absolute, out _) &&
            (returnUrl.StartsWith('/') || Uri.TryCreate(returnUrl, UriKind.Absolute, out _)) &&
            (connectReturnUrl.StartsWith('/') || Uri.TryCreate(connectReturnUrl, UriKind.Absolute, out _)),
            "Central Fitness Account sign-in is not configured.", 503);
        if (!environment.IsDevelopment())
            Validation.Require(clientSecret is not "replace-in-secret-manager", "Central Fitness Account client secret is not configured.", 503);
        return new(authority!, clientId!, clientSecret!, redirect!, returnUrl, connectReturnUrl);
    }

    private static bool FixedEquals(string? expected, string? actual)
        => !string.IsNullOrWhiteSpace(expected) && !string.IsNullOrWhiteSpace(actual) &&
            CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(actual));

    private static string RandomString(int bytes) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    private static string AppendError(string returnUrl, string error)
        => $"{returnUrl}{(returnUrl.Contains('?') ? '&' : '?')}central_error={Uri.EscapeDataString(error)}";
    private static CookieOptions CookieOptions(IHostEnvironment environment, TimeSpan lifetime)
        => new() { HttpOnly = true, Secure = !environment.IsDevelopment(), SameSite = environment.IsDevelopment() ? SameSiteMode.Lax : SameSiteMode.None, Path = "/", MaxAge = lifetime };
    private static void SetSessionCookie(HttpResponse response, string token, IHostEnvironment environment, string name)
        => response.Cookies.Append(name, token, new CookieOptions { HttpOnly = true, Secure = !environment.IsDevelopment(), SameSite = SameSiteMode.Lax, Path = "/", MaxAge = TimeSpan.FromDays(30), IsEssential = true });

    private sealed record LoginState(string State, string Nonce, string Verifier, string ReturnUrl, bool Connect,
        Guid? LocalUserId, int? ConnectionRevision = null);
    internal sealed record OidcSettings(string Authority, string ClientId, string ClientSecret, string RedirectUri, string ReturnUrl, string ConnectReturnUrl);
}
