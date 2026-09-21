using Workout.Api.Data;
using Workout.Api.Services.RestAlerts;
using Microsoft.AspNetCore.Mvc;

namespace Workout.Api.Endpoints;

public sealed record RestAlertSubscriptionInput(string DeviceId, string FcmToken);

public static class RestAlertEndpoints
{
    public static void MapRestAlerts(this WebApplication app)
    {
        app.MapGet("/api/notifications/rest-alerts", async (string deviceId, Guid? sessionId,
            WorkoutRestAlertService alerts, CancellationToken ct) => await alerts.Status(deviceId, sessionId, ct));
        app.MapPost("/api/notifications/rest-alerts/subscription", async (RestAlertSubscriptionInput input,
            WorkoutRestAlertService alerts, CancellationToken ct) => await alerts.Register(input.DeviceId, input.FcmToken, ct));
        app.MapDelete("/api/notifications/rest-alerts/subscription/{deviceId}", async (string deviceId,
            WorkoutRestAlertService alerts, CancellationToken ct) =>
        { await alerts.Unregister(deviceId, ct); return Results.NoContent(); });
        app.MapPost("/api/workouts/{sessionId:guid}/rest-alert", async (Guid sessionId, RestAlertScheduleInput input,
            WorkoutRestAlertService alerts, CancellationToken ct) => await alerts.Schedule(sessionId, input, ct));
        app.MapDelete("/api/workouts/{sessionId:guid}/rest-alert", async (Guid sessionId, [FromBody] RestAlertCancelInput input,
            WorkoutRestAlertService alerts, CancellationToken ct) =>
        { await alerts.Cancel(sessionId, input, ct); return Results.NoContent(); });

        app.MapPost("/internal/rest-alerts/dispatch", async (HttpContext http, RestAlertTaskInput input,
            ICloudTaskTokenValidator validator, WorkoutRestAlertService alerts, CancellationToken ct) =>
        {
            if (!await validator.IsTrustedAsync(http.Request.Headers.Authorization, ct)) return Results.Unauthorized();
            var result = await alerts.Dispatch(input.ScheduleId, ct);
            return result.Retry ? Results.StatusCode(StatusCodes.Status503ServiceUnavailable) : Results.Ok(result);
        });
        app.MapPost("/internal/rest-alerts/recover", async (HttpContext http,
            ICloudTaskTokenValidator validator, WorkoutRestAlertService alerts, CancellationToken ct) =>
        {
            if (!await validator.IsTrustedAsync(http.Request.Headers.Authorization, ct)) return Results.Unauthorized();
            return Results.Ok(new { repaired = await alerts.Recover(ct) });
        });
    }
}

public sealed record RestAlertTaskInput(Guid ScheduleId);
