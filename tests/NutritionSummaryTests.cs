using System.Net;
using System.Text;
using System.Text.Json;
using Fitness.Ai.Contracts;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Workout.Api.Data;
using Workout.Api.Services;
using Workout.Api.Services.AI.Tools;
using Xunit;

namespace Workout.Tests;

public sealed class NutritionSummaryTests
{
    [Fact]
    public async Task Legacy_context_is_explicitly_historical_and_never_certifies_intake_or_coverage()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        Connect(h, user.Id);
        h.Db.NutritionContexts.Add(new NutritionContextCache { UserId = user.Id, ContextJson = JsonSerializer.Serialize(
            new Workout.Api.Domain.NutritionTrainingContext(user.IdentitySubject, 1, "UTC", "gain", false, null, null, null,
                80, DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-10), null, null, DateTime.UtcNow.AddDays(-10), true)) });
        await h.Db.SaveChangesAsync();
        using var handler = new Handler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var result = await Service(h, handler).Get(14, default);
        Assert.Null(result.Summary);
        Assert.NotNull(result.HistoricalContext);
        Assert.Equal("stale", result.Freshness);
        Assert.False(result.CompleteCoverage);
    }

    [Fact]
    public async Task Malformed_partial_cache_cannot_claim_complete_coverage_or_a_fresh_empty_result()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        Connect(h, user.Id);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var malformed = Example(user.IdentitySubject, today) with { Days = [] };
        h.Db.NutritionContexts.Add(new NutritionContextCache { UserId = user.Id,
            SummaryJson = JsonSerializer.Serialize(malformed), SummaryFrom = today.AddDays(-13), SummaryTo = today,
            SummaryTimeZone = "UTC", SummaryFetchedAt = DateTime.UtcNow });
        await h.Db.SaveChangesAsync();
        using var handler = new Handler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var result = await Service(h, handler).Get(14, default);
        Assert.Equal(1, handler.Calls);
        Assert.Null(result.Summary);
        Assert.False(result.CompleteCoverage);
        Assert.Equal("unavailable", result.Availability);
    }

    [Fact]
    public async Task A_different_requested_window_or_timezone_day_does_not_reuse_the_wrong_average()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        Connect(h, user.Id);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        h.Db.NutritionContexts.Add(new NutritionContextCache { UserId = user.Id,
            SummaryJson = JsonSerializer.Serialize(Example(user.IdentitySubject, today)), SummaryFrom = today.AddDays(-13),
            SummaryTo = today, SummaryTimeZone = "UTC", SummaryFetchedAt = DateTime.UtcNow });
        await h.Db.SaveChangesAsync();
        using var handler = new Handler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var result = await Service(h, handler).Get(7, default);
        Assert.Equal(1, handler.Calls);
        Assert.False(result.CompleteCoverage);
        Assert.Equal("stale", result.Freshness);
        Assert.Equal(today.AddDays(-13), result.Summary!.From);
    }

    [Fact]
    public void Canonical_workout_fixture_round_trips_the_extended_producer_contract()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures/fitness-ai.examples.json")));
        var rows = JsonSerializer.Deserialize<Workout.Api.Domain.WorkoutTrainingSummary[]>(fixture.RootElement.GetProperty("workouts"),
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal(new DateOnly(2026, 10, 1), rows[1].CompletionDate);
        Assert.Equal(5, rows[1].EffortRecordedSets);
        Assert.Equal("squat:external", Assert.Single(rows[1].ExerciseMix!));
    }

    [Fact]
    public async Task Summary_has_separate_cache_and_preserves_intake_deficit_and_missing_protein()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        Connect(h, user.Id);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var value = Example(user.IdentitySubject, today);
        using var handler = new Handler(_ => JsonResponse(value));
        var service = Service(h, handler);
        var first = await service.Get(14, default);
        Assert.Equal("live", first.Freshness);
        Assert.Equal(600, first.Summary!.Period.AverageEstimatedDeficitCalories);
        Assert.Null(first.Summary.Period.AverageProtein);
        var repeated = await service.Get(14, default);
        Assert.Equal("fresh_cached", repeated.Freshness);
        Assert.Equal(1, handler.Calls);
        Assert.Null(h.Db.NutritionContexts.Single().LastSuccessAt);
        var tool = await new GetNutritionSummaryTool(service).ExecuteAsync(AiToolArgs.Empty,
            new AiToolContext("lb", today), default);
        Assert.True(JsonSerializer.Serialize(tool.Data).Length < 12000);
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, "stale")]
    [InlineData(HttpStatusCode.Forbidden, "unavailable")]
    public async Task Outage_can_use_dated_cache_but_authorization_failure_cannot(HttpStatusCode status, string freshness)
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        Connect(h, user.Id);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        h.Db.NutritionContexts.Add(new NutritionContextCache { UserId = user.Id,
            SummaryJson = JsonSerializer.Serialize(Example(user.IdentitySubject, today)), SummaryFrom = today.AddDays(-13),
            SummaryTo = today, SummaryTimeZone = "UTC", SummaryFetchedAt = DateTime.UtcNow.AddHours(-1) });
        await h.Db.SaveChangesAsync();
        using var handler = new Handler(_ => new HttpResponseMessage(status));
        var result = await Service(h, handler).Get(14, default);
        Assert.Equal(freshness, result.Freshness);
        Assert.Equal(status == HttpStatusCode.Forbidden, result.Summary == null);
    }

    [Fact]
    public async Task Revoked_or_other_account_summary_is_never_delivered()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        Connect(h, user.Id);
        await h.Db.SaveChangesAsync();
        using var handler = new Handler(_ => JsonResponse(Example("other-account", DateOnly.FromDateTime(DateTime.UtcNow))));
        Assert.Null((await Service(h, handler).Get(14, default)).Summary);
        h.Db.IntegrationGrants.Single().Status = "revoked";
        await h.Db.SaveChangesAsync();
        Assert.Equal("disconnected", (await Service(h, handler).Get(14, default)).ConnectionState);
        Assert.Equal(1, handler.Calls);
    }

    private static void Connect(Harness h, Guid userId) => h.Db.IntegrationGrants.Add(new IntegrationGrant
    { UserId = userId, Peer = "nutrition", Status = "active", CentralConnectionId = Guid.NewGuid(), CentralConnectionGeneration = 1 });

    private static NutritionPeerSummary Example(string subject, DateOnly today)
    {
        var days = Enumerable.Range(0, 14).Select(i => new NutritionDailySummary(today.AddDays(-i), i == 0 ? "incomplete" : "complete",
            false, 2, 1800, null, 60, 200, null, new(2000, 150, 60, 200, today.AddDays(-20)), 2400, .8, null, "expenditure_snapshot")).ToArray();
        return new(subject, 1, "UTC", today.AddDays(-13), today, DateTime.UtcNow, "kcal", new("lose", false, .5, .3, 21),
            new(today.AddDays(-13), today, 13, 0, 0, 1800, null, 13, 200, 13, 600, 0, null),
            new(3, today.AddDays(-13), today, 80, 79, 80, 79.5, "context_and_outlier_filtered"), days, true, "Qualified estimate");
    }

    private static NutritionSummaryService Service(Harness h, Handler handler)
    {
        // A saved grant must exist before the separate read context checks authorization.
        h.Db.SaveChanges();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Integrations:NutritionSummaryUrl"] = "https://nutrition.test/api/integrations/v1/nutrition-summary", ["Integrations:NutritionAccessToken"] = "test" }).Build();
        return new(h.Db, new Factory(handler), config, NullLogger<NutritionSummaryService>.Instance);
    }
    private static HttpResponseMessage JsonResponse(NutritionPeerSummary value) => new(HttpStatusCode.OK)
    { Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json") };
    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    { public HttpClient CreateClient(string name) => new(handler, disposeHandler: false); }
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        { Calls++; return Task.FromResult(respond(request)); }
    }
}
