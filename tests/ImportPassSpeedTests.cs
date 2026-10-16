using System.Net;
using Microsoft.Extensions.Configuration;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The section pass is measured in provider round trips. These pin the pieces that keep a pass from
/// waiting on itself: a refused request is asked again instead of failing its section, progress
/// writes inside one stage share a write, and every section reports where it stands.
public sealed class ImportPassSpeedTests
{
    private const string Outline = """
        {"programTitle":"Block","chunks":[
          {"label":"Week 1","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private static HttpResponseMessage Answer(string payload) => new(HttpStatusCode.OK)
    {
        Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(payload)}}}]}]}""")
    };

    private static WorkoutAi Ai(StubHandler handler) => new(new HttpClient(handler), new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["OpenAi:ApiKey"] = "test-key",
            ["OpenAi:Model"] = "gpt-5.4-mini",
            ["OpenAi:RetryDelayMs"] = "0"
        }).Build());

    [Fact]
    public async Task A_rate_limited_read_is_asked_again_instead_of_failing_its_section()
    {
        var refused = false;
        var handler = new StubHandler(_ =>
        {
            if (refused) return Answer(Outline);
            refused = true;
            return new HttpResponseMessage(HttpStatusCode.TooManyRequests);
        });

        var result = await Ai(handler).Outline("=== PAGE 1 ===\nWEEK 1", [], "user", default);

        Assert.Equal(2, handler.Calls);
        Assert.Equal("Block", result.Outline!.ProgramTitle);
    }

    [Fact]
    public async Task A_provider_that_keeps_refusing_is_reported_after_two_retries()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));

        var failure = await Assert.ThrowsAsync<DomainException>(() => Ai(handler).Outline("=== PAGE 1 ===\nWEEK 1", [], "user", default));

        Assert.Equal(3, handler.Calls);
        Assert.Equal(503, failure.Status);
    }

    [Fact]
    public async Task A_server_error_is_not_repeated()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError));

        await Assert.ThrowsAsync<DomainException>(() => Ai(handler).Outline("=== PAGE 1 ===\nWEEK 1", [], "user", default));

        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public void Every_section_reports_where_it_stands_in_outline_order()
    {
        var state = new ImportWorkState(SectionStages: new Dictionary<int, string> { [2] = "extract", [3] = "verify", [4] = "recover" });

        var progress = state.Progress(6, 1, new HashSet<int> { 0, 1 }, new HashSet<int> { 0, 1, 3 });

        Assert.Equal(["committed", "saved", "reading", "checking", "repairing", "queued"], progress.SectionStates);
        Assert.Equal(3, progress.SectionsWithResponses);
        Assert.Equal(1, progress.SectionsQueued);
    }

    [Fact]
    public async Task Progress_inside_one_stage_shares_a_write_and_a_stage_change_is_written_at_once()
    {
        var writes = new List<(string Stage, int Sections)>();
        var progress = new ImportSectionProgress((resolve, stages) =>
        {
            lock (writes) writes.Add((resolve(), stages.Count));
            return Task.FromResult(true);
        }, null);

        await progress.Update(0, "extract");
        await progress.Update(1, "extract");
        await progress.Update(0, "verify");
        Assert.Empty(writes);
        await progress.Settle();
        Assert.Equal([("extract", 2)], writes);

        // A repair must be on record before its read starts, so it is not left to the flush.
        await progress.Update(1, "recover");
        Assert.Equal(("recover", 2), writes[^1]);
        await progress.Settle();
        Assert.True(progress.LeaseHeld);
    }
}
