using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public record Credentials(string Username, string Password);
public record PasswordChange(string CurrentPassword, string NewPassword);

public static class AuthEndpoints
{
    public static void MapAuth(this WebApplication app)
    {
        app.MapGet("/api/auth/status", async (AppDb db, IConfiguration config, CancellationToken ct)
            => new { registrationOpen = config.GetValue("Auth:LegacyEnabled", true) && await db.Users.CountAsync(ct) < config.GetValue("Auth:MaxUsers", 2) });

        if (app.Environment.IsDevelopment())
            app.MapPost("/api/auth/dev-reset", async (AppDb db, CancellationToken ct) =>
            {
                await db.Database.EnsureDeletedAsync(ct);
                await db.Database.EnsureCreatedAsync(ct);
                return Results.Ok(new { reset = true });
            });

        app.MapPost("/api/auth/register", async (Credentials input, AuthService auth, IConfiguration config, HttpContext http, CancellationToken ct) =>
        {
            Validation.Require(config.GetValue("Auth:LegacyEnabled", true), "Local registration is disabled; use the central Fitness Account.", 410);
            var user = await auth.Register(input.Username, input.Password, ct);
            SetCookie(http, await auth.CreateSession(user.Id, ct));
            return Results.Ok(new { user.Id, user.Username });
        }).RequireRateLimiting("auth");

        app.MapPost("/api/auth/login", async (Credentials input, AuthService auth, IConfiguration config, HttpContext http, CancellationToken ct) =>
        {
            Validation.Require(config.GetValue("Auth:LegacyEnabled", true), "Local login is disabled; use the central Fitness Account.", 410);
            var user = await auth.Login(input.Username, input.Password, ct);
            SetCookie(http, await auth.CreateSession(user.Id, ct));
            return Results.Ok(new { user.Id, user.Username });
        }).RequireRateLimiting("auth");

        app.MapGet("/api/auth/me", async (AppDb db, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == db.CurrentUser, ct);
            return new { user.Id, user.Username, user.Unit, user.Theme, user.RestSeconds };
        });

        app.MapPost("/api/auth/logout", async (AppDb db, HttpContext http, CancellationToken ct) =>
        {
            var hash = AuthService.Hash(http.Request.Cookies[AuthService.Cookie] ?? "");
            await db.Sessions.Where(s => s.Hash == hash).ExecuteDeleteAsync(ct);
            http.Response.Cookies.Delete(AuthService.Cookie, new CookieOptions { Path = "/" });
            return Results.NoContent();
        });

        app.MapPost("/api/auth/password", async (PasswordChange input, AuthService auth, AppDb db, IConfiguration config, HttpContext http, CancellationToken ct) =>
        {
            Validation.Require(config.GetValue("Auth:LegacyEnabled", true), "Local password changes are disabled; use the central Fitness Account.", 410);
            await auth.ChangePassword(db.CurrentUser!.Value, input.CurrentPassword, input.NewPassword, ct);
            http.Response.Cookies.Delete(AuthService.Cookie, new CookieOptions { Path = "/" });
            return Results.NoContent();
        }).RequireRateLimiting("auth");
    }

    private static void SetCookie(HttpContext http, string token) => http.Response.Cookies.Append(AuthService.Cookie, token, new CookieOptions
    {
        HttpOnly = true,
        Secure = !http.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment() || http.Request.IsHttps,
        SameSite = SameSiteMode.Strict, Path = "/", MaxAge = TimeSpan.FromDays(30), IsEssential = true
    });
}
