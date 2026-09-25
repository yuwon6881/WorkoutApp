using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record NutritionContextResult(
    NutritionTrainingContext? Context,
    string Mode,
    bool Cached,
    bool Confirmed,
    string? Error);

/// Optional, fail-open Nutrition integration. A workout can always start when Nutrition is down;
/// only the confirmed mode and bodyweight context are reused, and only for seven calendar days.
public sealed class NutritionContextService(AppDb db, IHttpClientFactory clients, IConfiguration config, IntegrationTokenService? peerTokens = null)
{
    /// Workout start waits on this read, so it keeps a short bound and falls back to the cache.
    public static readonly TimeSpan StartDeadline = TimeSpan.FromSeconds(2);
    /// Explicit refreshes may wait out a scale-to-zero cold start of Nutrition, whose handler
    /// also validates the connection with Fitness Account before answering.
    public static readonly TimeSpan RefreshDeadline = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan CacheWindow = TimeSpan.FromDays(7);

    public async Task<NutritionContextResult> Get(CancellationToken ct, TimeSpan? deadline = null)
    {
        var cached = await db.NutritionContexts.AsNoTracking().SingleOrDefaultAsync(ct);
        var now = DateTime.UtcNow;
        var url = config["Integrations:NutritionTrainingContextUrl"];
        var connected = await db.IntegrationGrants.AsNoTracking().AnyAsync(x => x.Peer == "nutrition" && x.Status == "active"
            && x.CentralConnectionId != null && x.CentralConnectionGeneration != null, ct);
        if (connected && !string.IsNullOrWhiteSpace(url))
        {
            try
            {
                // Token renewal has its own ten-second bound. A short peer-data deadline must not
                // cancel the durable connection's server-to-server token exchange.
                var token = peerTokens is null ? null
                    : await peerTokens.AccessToken("nutrition", "nutrition.training_context.read", ct);
                if (peerTokens is not null && string.IsNullOrWhiteSpace(token))
                    throw new InvalidOperationException("Nutrition access is not available.");
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(deadline ?? StartDeadline);
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                if (!string.IsNullOrWhiteSpace(token)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                var subject = await db.Users.AsNoTracking().Where(u => u.Id == db.CurrentUser).Select(u => u.IdentitySubject).SingleOrDefaultAsync(ct);
                if (!string.IsNullOrWhiteSpace(subject)) request.Headers.Add("X-Identity-Subject", subject);
                var response = await clients.CreateClient("nutrition").SendAsync(request, timeout.Token);
                response.EnsureSuccessStatusCode();
                var payload = await response.Content.ReadFromJsonAsync<NutritionTrainingContext>(cancellationToken: timeout.Token);
                if (payload is not null && SubjectMatches(payload, subject))
                {
                    var context = payload with { RetrievedAt = now, Confirmed = payload.Confirmed && !string.IsNullOrWhiteSpace(payload.Subject) };
                    try { await SaveSuccess(context, now, ct); }
                    catch (DbUpdateException) { /* A cache write must not make a workout unavailable. */ }
                    return Result(context, cached: false, null, now);
                }
                throw new InvalidOperationException("Nutrition returned an invalid training context.");
            }
            catch (Exception ex) when ((ex is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException)
                && !ct.IsCancellationRequested)
            {
                const string warning = "Nutrition data could not be refreshed right now.";
                await SaveError(warning, now, ct);
                return FromCache(cached, now, warning);
            }
        }
        // The cache is a fallback for a Nutrition outage, not a substitute for consent. Once the
        // connection is inactive, a cached goal must not keep steering progression.
        return connected ? FromCache(cached, now, null) : new(null, ProgressionModes.Normal, false, false, null);
    }

    public static string Mode(NutritionTrainingContext? context, DateTime nowUtc)
    {
        if (context is null || !context.Confirmed || context.EffectiveGoal != "lose" || context.PhaseComplete) return ProgressionModes.Normal;
        if (nowUtc - context.RetrievedAt > CacheWindow) return ProgressionModes.Normal;
        // A numeric observed rate is only qualified when Nutrition supplied its required
        // three-weigh-in, fourteen-day window. An unqualified cached number must not move a
        // workout into preservation mode.
        var observed = context.ObservedWindowDays is >= 14 ? context.ObservedLossRatePercent : null;
        var validRates = new[] { context.TargetRatePercent, observed }
            .Where(rate => rate is >= 0).Select(rate => Math.Abs(rate!.Value)).ToList();
        if (validRates.Count == 0) return ProgressionModes.Normal;
        return validRates.Max() >= .75 ? ProgressionModes.Preservation : ProgressionModes.Conservative;
    }

    private async Task SaveSuccess(NutritionTrainingContext context, DateTime now, CancellationToken ct)
    {
        var row = await db.NutritionContexts.SingleOrDefaultAsync(ct);
        if (row is null)
        {
            row = new NutritionContextCache { UserId = db.CurrentUser!.Value };
            db.NutritionContexts.Add(row);
        }
        row.ContextJson = Json.Write(context); row.LastSuccessAt = now; row.LastError = ""; row.LastErrorAt = null; row.Revision++;
        await db.SaveChangesAsync(ct);
    }

    private async Task SaveError(string error, DateTime now, CancellationToken ct)
    {
        try
        {
            var row = await db.NutritionContexts.SingleOrDefaultAsync(ct);
            if (row is null)
            {
                row = new NutritionContextCache { UserId = db.CurrentUser!.Value };
                db.NutritionContexts.Add(row);
            }
            row.LastError = error.Length > 500 ? error[..500] : error; row.LastErrorAt = now; row.Revision++;
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Context is advisory. A failed cache write must not stop a workout from starting.
        }
    }

    private NutritionContextResult FromCache(NutritionContextCache? row, DateTime now, string? error)
    {
        if (row is null || string.IsNullOrWhiteSpace(row.ContextJson))
            return new(null, ProgressionModes.Normal, false, false, error);
        try
        {
            var context = Json.Read<NutritionTrainingContext>(row.ContextJson);
            var fresh = row.LastSuccessAt is { } success && now - success <= CacheWindow;
            var message = error ?? row.LastError;
            return fresh ? Result(context, true, message, now) :
                new(context with { Confirmed = false, Cached = true, Error = message }, ProgressionModes.Normal, true, false, message);
        }
        catch (Exception ex) when (ex is JsonException or DomainException)
        {
            return new(null, ProgressionModes.Normal, false, false, error ?? "Nutrition context cache is unavailable.");
        }
    }

    private static NutritionContextResult Result(NutritionTrainingContext context, bool cached, string? error, DateTime now)
    {
        var normalized = context with { RetrievedAt = context.RetrievedAt == default ? now : context.RetrievedAt, Cached = cached, Error = error };
        return new(normalized, Mode(normalized, now), cached, normalized.Confirmed, error);
    }

    private static bool SubjectMatches(NutritionTrainingContext context, string? expected)
        => !string.IsNullOrWhiteSpace(expected) && string.Equals(expected, context.Subject, StringComparison.Ordinal);
}
