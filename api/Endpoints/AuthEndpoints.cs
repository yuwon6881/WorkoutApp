using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuth(this WebApplication app)
    {
        if (app.Environment.IsDevelopment())
            app.MapPost("/api/auth/dev-reset", async (AppDb db, CancellationToken ct) =>
            {
                await db.Database.EnsureDeletedAsync(ct);
                await db.Database.EnsureCreatedAsync(ct);
                return Results.Ok(new { reset = true });
            });

        app.MapGet("/api/auth/me", async (AppDb db, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == db.CurrentUser, ct);
            return new { user.Id, displayName = user.DisplayName, user.Unit, user.Theme, user.RestSeconds };
        });

        app.MapPost("/api/auth/logout", async (AppDb db, HttpContext http, CancellationToken ct) =>
        {
            var hash = AuthService.Hash(http.Request.Cookies[AuthService.Cookie] ?? "");
            await db.Sessions.Where(s => s.Hash == hash).ExecuteDeleteAsync(ct);
            http.Response.Cookies.Delete(AuthService.Cookie, new CookieOptions { Path = "/" });
            return Results.NoContent();
        });
    }
}
