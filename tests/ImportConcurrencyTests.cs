using System.Net;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Sections are independent reads of different pages, and the model's answer is what takes the
/// time. Reading them one after another made an import wait for the sum of its sections; they are
/// sent together and merged in outline order instead, so the draft is assembled exactly as before
/// while the import takes as long as its slowest section.
public sealed class ImportConcurrencyTests
{
    private const string ThreeSections = """
        {"programTitle":"Nine week block","chunks":[
          {"label":"Block 1","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1},
          {"label":"Block 2","block":"Base","phase":"Main","weekFrom":2,"weekTo":2,"pageFrom":2,"pageTo":2,"dayCount":1},
          {"label":"Block 3","block":"Base","phase":"Peak","weekFrom":3,"weekTo":3,"pageFrom":3,"pageTo":3,"dayCount":1}]}
        """;

    private static string Day(int week, string phase) => $$"""
        {"programTitle":"Nine week block","days":[
          {"block":"Base","phase":"{{phase}}","weekNumber":{{week}},"phaseWeek":1,"dayName":"Week {{week}} Upper","isRestDay":false,"weekday":1,"sourcePage":{{week}},"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":{{week}},"sets":[
              {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":{{week}}}]}]}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source() => new("nippard.pdf", 3,
        Enumerable.Range(1, 3).Select(page => new ImportPageText(page, $"WEEK {page}\nBench 3x5")).ToList());

    /// Answers by what a request asks for rather than by the order it arrives in, because with
    /// sections in flight together that order is no longer fixed.
    private sealed class SectionHandler(Func<string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public int PeakInFlight { get; private set; }
        private int inFlight;
        private readonly Lock guard = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            lock (guard)
            {
                Calls++;
                inFlight++;
                PeakInFlight = Math.Max(PeakInFlight, inFlight);
            }
            // A real read takes time; the pause is what makes overlap observable at all.
            try { await Task.Delay(120, ct); return respond(body); }
            finally { lock (guard) inFlight--; }
        }
    }

    private static HttpResponseMessage Answer(string payload) => new(HttpStatusCode.OK)
    {
        Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(payload)}}}]}]}""")
    };

    /// Each section names itself in the request, so the stand-in can answer the one being asked for.
    private static HttpResponseMessage BySection(string request) =>
        request.Contains("training_program_outline") ? Answer(ThreeSections)
        : request.Contains("Block 1") ? Answer(Day(1, "Intro"))
        : request.Contains("Block 2") ? Answer(Day(2, "Main"))
        : Answer(Day(3, "Peak"));

    [Fact]
    public async Task Every_remaining_section_is_read_in_one_pass_and_merged_in_outline_order()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var handler = new SectionHandler(BySection);
        var imports = h.Imports(handler);

        var pending = await imports.Create(Source(), default);
        Assert.Equal(3, pending.ChunksTotal);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(3, ready.ChunksDone);
        // Outline order, not the order the answers happened to come back in.
        Assert.Equal([1, 2, 3], ready.Draft!.Workouts.Select(day => day.Week));
        Assert.Equal(["Intro", "Main", "Peak"], ready.Draft.Workouts.Select(day => day.Phase));
        Assert.Equal(4, handler.Calls);
    }

    [Fact]
    public async Task The_sections_are_in_flight_at_the_same_time()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var handler = new SectionHandler(BySection);
        var imports = h.Imports(handler);

        var pending = await imports.Create(Source(), default);
        await imports.Extract(pending.Id, default);

        Assert.True(handler.PeakInFlight > 1, $"sections were read one at a time (peak in flight: {handler.PeakInFlight})");
    }

    [Fact]
    public async Task Every_section_is_metered_so_the_daily_budget_still_counts_them_all()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var imports = h.Imports(new SectionHandler(BySection));

        var pending = await imports.Create(Source(), default);
        await imports.Extract(pending.Id, default);

        // One outline read plus one per section.
        Assert.Equal(4, (await h.Db.Usage.AsNoTracking().SingleAsync()).Count);
    }

    [Fact]
    public async Task A_section_that_fails_leaves_the_ones_before_it_committed_and_the_rest_to_retry()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var failing = new SectionHandler(request => request.Contains("Block 2")
            ? new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("{}") }
            : BySection(request));
        var imports = h.Imports(failing);

        var pending = await imports.Create(Source(), default);
        await Assert.ThrowsAsync<DomainException>(() => imports.Extract(pending.Id, default));

        var row = await h.Db.Imports.AsNoTracking().SingleAsync();
        Assert.Equal(ImportStatus.Pending, row.Status);
        // Section one committed; the failure stops the merge there, so section three is read again
        // rather than being stitched in ahead of the section it follows.
        Assert.Equal(1, row.ChunksDone);
        Assert.NotEqual("", row.SourceTextJson);
        h.Db.ChangeTracker.Clear();

        var recovered = h.Imports(new SectionHandler(BySection));
        var ready = await recovered.Retry(pending.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal([1, 2, 3], ready.Draft!.Workouts.Select(day => day.Week));
    }
}
