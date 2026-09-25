using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class GoogleHealthEndpoints
{
    public sealed record ConnectInput(bool SyncWorkout = false);
    public sealed record WorkoutSyncPreferenceInput(bool Enabled, long Revision);

    public static void MapGoogleHealth(this WebApplication app)
    {
        app.MapGet("/api/integrations/google-health", async (GoogleHealthService service, AppDb db, CancellationToken ct) =>
        {
            var result = await service.GetStatusAsync(db.CurrentUser!.Value, ct);
            return Results.Ok(result);
        });

        app.MapPost("/api/integrations/google-health/connect", async (ConnectInput? input, GoogleHealthService service, AppDb db, HttpContext http, CancellationToken ct) =>
        {
            var token = http.Request.Cookies[AuthService.Cookie];
            var sessionHash = AuthService.Hash(token ?? "");
            var origin = http.Request.Headers.Origin.ToString();
            if (string.IsNullOrEmpty(origin))
                origin = $"{http.Request.Scheme}://{http.Request.Host}";

            var result = await service.GenerateConnectUrlAsync(
                db.CurrentUser!.Value,
                sessionHash,
                origin,
                ct,
                input?.SyncWorkout == true);
            return Results.Ok(result);
        });

        app.MapGet("/api/integrations/google-health/callback", async (
            [FromQuery] string? code,
            [FromQuery] string? state,
            [FromQuery] string? error,
            GoogleHealthService service,
            AppDb db,
            HttpContext http,
            CancellationToken ct) =>
        {
            var token = http.Request.Cookies[AuthService.Cookie];
            if (string.IsNullOrEmpty(token))
                return Results.Redirect("/settings?google_health=error&code=session_expired");

            var sessionHash = AuthService.Hash(token);
            var session = await db.Sessions.AsNoTracking().SingleOrDefaultAsync(s => s.Hash == sessionHash && s.Expires > DateTime.UtcNow, ct);
            if (session == null)
                return Results.Redirect("/settings?google_health=error&code=session_expired");

            db.CurrentUser = session.UserId;
            var origin = $"{http.Request.Scheme}://{http.Request.Host}";
            var redirectUrl = await service.HandleCallbackAsync(code, state, error, session.UserId, sessionHash, origin, ct);
            return Results.Redirect(redirectUrl);
        });

        app.MapPost("/api/integrations/google-health/disconnect", async (GoogleHealthService service, AppDb db, CancellationToken ct) =>
        {
            var result = await service.DisconnectAsync(db.CurrentUser!.Value, ct);
            return Results.Ok(result);
        });

        app.MapPost("/api/integrations/google-health/workout-sync/preference", async (WorkoutSyncPreferenceInput input, GoogleHealthWorkoutSyncService service, CancellationToken ct) =>
            Results.Ok(await service.SetPreferenceAsync(input.Enabled, input.Revision, ct)));

        app.MapPost("/api/integrations/google-health/workout-sync/recover", async (GoogleHealthWorkoutSyncRecoveryInput input, GoogleHealthWorkoutSyncService service, CancellationToken ct) =>
            Results.Ok(await service.RecoverAsync(input.WorkoutSessionId, ct)));

        app.MapPost("/internal/google-health-workout-sync", async (HttpRequest request, IConfiguration config, GoogleHealthWorkoutSyncService service, CancellationToken ct) =>
        {
            var expected = config["Maintenance:Secret"]?.Trim() ?? "";
            var presented = request.Headers["X-Workout-Maintenance-Secret"].ToString();
            Validation.Require(!string.IsNullOrWhiteSpace(expected) &&
                CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(presented)),
                "Maintenance is not available.", 404);
            return Results.Ok(await service.ProcessDueAsync(ct));
        }).DisableAntiforgery();
    }
}
