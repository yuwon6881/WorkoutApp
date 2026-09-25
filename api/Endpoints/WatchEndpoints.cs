using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public sealed record WatchPairingStartInput(string DeviceId, string DeviceName, string DeviceToken);
public sealed record WatchPairingStatusInput(Guid PairingId, string DeviceToken);
public sealed record WatchPairingApproveInput(string Code);
public sealed record WatchFinishInput(int Revision, Guid MutationId, DateTimeOffset FinishedAt);

public static class WatchEndpoints
{
    public static void MapWatch(this WebApplication app)
    {
        app.MapPost("/api/watch/pairing/start", async (WatchPairingStartInput input, WatchPairingService pairings, CancellationToken ct)
            => Results.Ok(await pairings.Start(input.DeviceId, input.DeviceName, input.DeviceToken, ct)))
            .RequireRateLimiting("watch-pair-start");
        app.MapPost("/api/watch/pairing/status", async (WatchPairingStatusInput input, WatchPairingService pairings, CancellationToken ct)
            => Results.Ok(await pairings.Status(input.PairingId, input.DeviceToken, ct)))
            .RequireRateLimiting("watch-pair-status");
        app.MapPost("/api/watch/pairing/approve", async (WatchPairingApproveInput input, WatchPairingService pairings, CancellationToken ct)
            => Results.Ok(await pairings.Approve(input.Code, ct)))
            .RequireRateLimiting("watch-pair-approve");

        app.MapGet("/api/watch/devices", async (WatchPairingService pairings, CancellationToken ct)
            => Results.Ok(await pairings.List(ct)));
        app.MapDelete("/api/watch/devices/{id:guid}", async (Guid id, WatchPairingService pairings, CancellationToken ct) =>
        {
            await pairings.Revoke(id, ct);
            return Results.NoContent();
        });

        app.MapGet("/api/watch/active", async (AppDb db, WorkoutService workouts, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleAsync(item => item.Id == db.CurrentUser, ct);
            return Results.Ok(new { unit = user.Unit, restSeconds = user.RestSeconds, session = await workouts.Active(ct) });
        });
        app.MapGet("/api/watch/workouts/{id:guid}", async (Guid id, WorkoutService workouts, CancellationToken ct)
            => Results.Ok(await workouts.Get(id, ct)));
        app.MapPatch("/api/watch/workouts/{id:guid}/sets/{setId:guid}", async (Guid id, Guid setId, JsonElement payload,
            WorkoutService workouts, CancellationToken ct) => Results.Ok(await workouts.PatchSet(id, setId, payload, ct)));
        app.MapPost("/api/watch/workouts/{id:guid}/pause", async (Guid id, WorkoutTimingInput input, WorkoutService workouts, CancellationToken ct)
            => Results.Ok(await workouts.Pause(id, input, ct)));
        app.MapPost("/api/watch/workouts/{id:guid}/resume", async (Guid id, WorkoutTimingInput input, WorkoutService workouts, CancellationToken ct)
            => Results.Ok(await workouts.Resume(id, input, ct)));
        app.MapPost("/api/watch/workouts/{id:guid}/finish", async (Guid id, WatchFinishInput input,
            WorkoutService workouts, CancellationToken ct) => Results.Ok(await workouts.Finish(id, input.Revision, ct,
                retainExerciseSwaps: false, mutationId: input.MutationId, finishedAt: input.FinishedAt)));
        app.MapPost("/api/watch/session/revoke", async (HttpContext http, WatchPairingService pairings, CancellationToken ct) =>
        {
            var token = http.Request.Headers[WatchAuthentication.DeviceTokenHeader].ToString();
            await pairings.RevokeCurrent(token, ct);
            return Results.NoContent();
        });
    }
}
