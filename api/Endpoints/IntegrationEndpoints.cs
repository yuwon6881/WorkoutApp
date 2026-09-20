using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class IntegrationEndpoints
{
    public const string TrainingScope = "nutrition.training_context.read";
    public const string SummaryScope = "workout.training_summary.read";

    public static void MapIntegrations(this WebApplication app)
    {
        app.MapPost("/api/integrations/refresh", async (NutritionContextService context, CancellationToken ct) =>
        {
            var result = await context.Get(ct);
            return Results.Ok(new { mode = result.Mode, cached = result.Cached, confirmed = result.Confirmed, error = result.Error });
        });

        app.MapGet("/api/integrations/v1/training-summary", async (HttpContext context, OpenIddictAccessTokenService tokens,
            IntegrationTokenService peerTokens, AppDb db, WorkoutService workouts, DateOnly? from, DateOnly? to, CancellationToken ct) =>
        {
            var token = await tokens.Require(context, SummaryScope, ct);
            await peerTokens.ValidateIncoming(token, ct);
            var user = await db.Users.SingleOrDefaultAsync(u => u.IdentitySubject == token.Subject, ct);
            Validation.Require(user != null, "That shared account is not mapped to this Workout account.", 403);
            db.CurrentUser = user!.Id;
            return Results.Ok(await workouts.TrainingSummary(from, to, ct));
        });

        app.MapGet("/api/integrations/connected", async (AppDb db, IntegrationTokenService peerTokens, CancellationToken ct) =>
        {
            var grant = await db.IntegrationGrants.AsNoTracking().SingleOrDefaultAsync(x => x.Peer == "nutrition", ct);
            var connectionState = await peerTokens.ConnectionState("nutrition", ct);
            var context = await db.NutritionContexts.AsNoTracking().SingleOrDefaultAsync(ct);
            var syncWarning = connectionState == "temporary_unavailable"
                || (context?.LastErrorAt is { } errorAt && (context.LastSuccessAt is null || errorAt > context.LastSuccessAt));
            if (connectionState == "connected" && syncWarning) connectionState = "temporary_unavailable";
            return Results.Ok(new[] { new
            {
                peer = "nutrition",
                status = connectionState is "connected" or "temporary_unavailable" ? "active" : connectionState,
                connectionState,
                canDisconnect = grant is { Status: "active" or "reconnect_required" },
                syncWarning,
                scopes = grant is null ? new List<string>() : JsonSerializer.Deserialize<List<string>>(grant.ScopesJson, Json.Options) ?? new List<string>(),
                grantedAt = grant?.GrantedAt,
                revokedAt = grant?.RevokedAt
            }});
        });

        app.MapDelete("/api/integrations/connected/{peer}", async (string peer, AppDb db, IntegrationTokenService peerTokens, CancellationToken ct) =>
        {
            Validation.Require(peer == "nutrition", "Choose a supported connected app.");
            await peerTokens.RevokeAndPurge(peer, ct);
            var cache = await db.NutritionContexts.SingleOrDefaultAsync(ct);
            if (cache is not null) { db.NutritionContexts.Remove(cache); await db.SaveChangesAsync(ct); }
            return Results.NoContent();
        });
    }
}
