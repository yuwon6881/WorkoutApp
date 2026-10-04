using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Fitness.Ai.Contracts;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record NutritionSummaryResult(string ConnectionState, string Availability, string Freshness,
    NutritionPeerSummary? Summary, string? Warning, bool CompleteCoverage, NutritionTrainingContext? HistoricalContext = null);

// Chat freshness is separate from workout-start context and never wakes Nutrition at launch.
public sealed class NutritionSummaryService(AppDb db, IHttpClientFactory clients, IConfiguration config,
    ILogger<NutritionSummaryService> logger, IntegrationTokenService? tokens = null)
{
    public async Task<NutritionSummaryResult> Get(int days, CancellationToken ct)
    {
        Validation.Require(days is >= 1 and <= 28, "Choose up to 28 nutrition days.");
        var grant = await db.IntegrationGrants.AsNoTracking().SingleOrDefaultAsync(x => x.Peer == "nutrition", ct);
        if (grant?.Status != "active" || grant.CentralConnectionId == null || grant.CentralConnectionGeneration == null)
            return new(grant?.Status == "reconnect_required" ? "reconnect_required" : "disconnected", "unavailable", "unavailable", null, null, false);
        var row = await db.NutritionContexts.AsNoTracking().SingleOrDefaultAsync(ct);
        var subject = await db.Users.Where(u => u.Id == db.CurrentUser).Select(u => u.IdentitySubject).SingleAsync(ct);
        var summary = Read(row?.SummaryJson);
        if (!Valid(summary, subject)) summary = null;
        NutritionTrainingContext? historical = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(row?.ContextJson)) historical = JsonSerializer.Deserialize<NutritionTrainingContext>(row.ContextJson, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }
        catch (JsonException) { }
        if (historical?.Subject != subject) historical = null;
        NutritionSummaryResult Fallback(NutritionPeerSummary? value, bool complete, string warning) =>
            new("temporary_unavailable", value != null || historical != null ? "available" : "unavailable",
                value != null || historical != null ? "stale" : "unavailable", value, warning, complete,
                value == null ? historical : null);
        var now = DateTime.UtcNow;
        var zone = summary != null && TimeZoneInfo.TryFindSystemTimeZoneById(summary.TimeZone, out var knownZone) ? knownZone : null;
        var today = zone == null ? (DateOnly?)null : DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(now, zone));
        var covered = today != null && row?.SummaryFrom == today.Value.AddDays(1 - days) && row?.SummaryTo == today
            && row.SummaryTimeZone == summary?.TimeZone;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        if (tokens != null)
        {
            string state;
            try { state = await tokens.ConnectionState("nutrition", timeout.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { state = "temporary_unavailable"; }
            if (state == "temporary_unavailable") return Fallback(summary, covered, "Nutrition consent could not be revalidated right now.");
            if (state != "connected") return new(state, "unavailable", "unavailable", null, "Reconnect Nutrition in Settings.", false);
        }
        if (summary != null && covered && row?.SummaryFetchedAt >= now.AddMinutes(-15))
        {
            logger.LogInformation("Nutrition AI summary cache hit for {Days} days.", days);
            return new("connected", "available", "fresh_cached", summary, null, true);
        }
        var url = config["Integrations:NutritionSummaryUrl"];
        if (string.IsNullOrWhiteSpace(url))
        {
            var contextUrl = config["Integrations:NutritionTrainingContextUrl"];
            if (Uri.TryCreate(contextUrl, UriKind.Absolute, out var endpoint))
                url = new Uri(endpoint, "/api/integrations/v1/nutrition-summary").ToString();
        }
        if (string.IsNullOrWhiteSpace(url)) return Fallback(summary, covered, "The Nutrition summary endpoint is not configured.");
        try
        {
            var token = tokens == null ? config["Integrations:NutritionAccessToken"] : await tokens.AccessToken("nutrition", "nutrition.training_context.read", timeout.Token);
            if (string.IsNullOrWhiteSpace(token))
            {
                var stillActive = await db.IntegrationGrants.AsNoTracking().AnyAsync(x => x.Peer == "nutrition" && x.Status == "active", ct);
                return stillActive ? Fallback(summary, covered, "Nutrition authorization could not be refreshed.")
                    : new("reconnect_required", "unavailable", "unavailable", null, "Reconnect Nutrition in Settings.", false);
            }
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{url}{(url.Contains('?') ? '&' : '?')}days={days}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            logger.LogInformation("Nutrition AI summary peer read for {Days} days.", days);
            using var response = await clients.CreateClient("nutrition").SendAsync(request, timeout.Token);
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return new("reconnect_required", "unavailable", "unavailable", null, "Nutrition access was rejected. Check Settings.", false);
            response.EnsureSuccessStatusCode();
            var value = await response.Content.ReadFromJsonAsync<NutritionPeerSummary>(cancellationToken: timeout.Token);
            if (!Valid(value, subject) || value!.Days.Count != days
                || !TimeZoneInfo.TryFindSystemTimeZoneById(value.TimeZone, out var peerZone)
                || value.To != DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(now, peerZone)))
                return Fallback(summary, covered, "Nutrition returned an invalid or incomplete summary.");
            var cache = await db.NutritionContexts.SingleOrDefaultAsync(ct);
            if (cache == null) { cache = new NutritionContextCache { UserId = db.CurrentUser!.Value }; db.NutritionContexts.Add(cache); }
            cache.SummaryJson = JsonSerializer.Serialize(value);
            cache.SummaryFrom = value.From; cache.SummaryTo = value.To; cache.SummaryTimeZone = value.TimeZone; cache.SummaryFetchedAt = now;
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex) { logger.LogWarning(ex, "Nutrition summary cache could not be saved."); }
            return new("connected", "available", "live", value, null, true);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return Fallback(summary, covered, "Nutrition took too long to refresh.");
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException)
        {
            logger.LogWarning(ex, "Nutrition AI summary refresh failed.");
            return Fallback(summary, covered, "Nutrition could not be refreshed right now.");
        }
    }

    private static bool Valid(NutritionPeerSummary? value, string subject) =>
        value != null && value.Subject == subject && value.EnergyUnit == "kcal" && value.RetrievedAt != default
        && value.Period != null && value.Weight != null && value.GoalContext != null && value.Days != null
        && value.To.DayNumber - value.From.DayNumber is >= 0 and < 28
        && value.Days.Count == value.To.DayNumber - value.From.DayNumber + 1
        && value.Days.All(d => d != null && d.Date >= value.From && d.Date <= value.To)
        && value.Days.Select(d => d.Date).Distinct().Count() == value.Days.Count
        && value.Period.From == value.From && value.Period.To == value.To
        && TimeZoneInfo.TryFindSystemTimeZoneById(value.TimeZone, out _);

    private static NutritionPeerSummary? Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<NutritionPeerSummary>(json); }
        catch (JsonException) { return null; }
    }

}
