using System.Net;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A written program names its sections the way a coach talks about them, so the same name comes
/// back twice all the time: "Deload" printed at the end of every block, or one phase split across
/// page ranges. Nothing is keyed on that name — sections are addressed by their outline position —
/// but the outline used to be refused outright with "AI returned duplicate extraction chunk
/// labels", which killed the import on its first read and failed the same way on every retry.
/// The repeat is renamed with what separates it from the first instead.
public sealed class ImportChunkLabelTests
{
    private const string TwoDeloads = """
        {"programTitle":"Nine week block","chunks":[
          {"label":"Deload","block":"Block 1","phase":"Deload","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1},
          {"label":"Deload","block":"Block 2","phase":"Deload","weekFrom":2,"weekTo":2,"pageFrom":2,"pageTo":2,"dayCount":1}]}
        """;

    private static string Day(int week, string block) => $$"""
        {"programTitle":"Nine week block","days":[
          {"block":"{{block}}","phase":"Deload","weekNumber":{{week}},"phaseWeek":1,"dayName":"Week {{week}} Upper","isRestDay":false,"weekday":1,"sourcePage":{{week}},"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":{{week}},"sets":[
              {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":{{week}}}]}]}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source() => new("nippard.pdf", 2,
        Enumerable.Range(1, 2).Select(page => new ImportPageText(page, $"WEEK {page}\nBarbell bench press 3x5")).ToList());

    /// Sections are read concurrently, so the stand-in answers by what a request asks for rather
    /// than by the order it arrives in.
    private sealed class SectionHandler(Func<string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            return respond(body);
        }
    }

    private static HttpResponseMessage Answer(string payload) => new(HttpStatusCode.OK)
    {
        Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(payload)}}}]}]}""")
    };

    private static HttpResponseMessage BySection(string request) =>
        request.Contains("training_program_outline") ? Answer(TwoDeloads)
        : request.Contains("weeks 1-1") ? Answer(Day(1, "Block 1"))
        : Answer(Day(2, "Block 2"));

    [Fact]
    public void A_repeated_section_name_is_renamed_rather_than_failing_the_outline()
    {
        var chunks = ImportValidation.SplitChunks([
            new AiOutlineChunk("Deload", "Block 1", "Deload", 1, 1, 1, 1, 1),
            new AiOutlineChunk("Deload", "Block 2", "Deload", 2, 2, 2, 2, 1)
        ]);

        Assert.Equal(["Deload", "Deload (weeks 2-2)"], chunks.Select(chunk => chunk.Label));
        // The boundaries the outline drew are untouched; only what the reviewer reads changed.
        Assert.Equal([(1, 1), (2, 2)], chunks.Select(chunk => (chunk.WeekFrom, chunk.PageFrom)));
    }

    [Fact]
    public void A_name_repeated_over_the_same_weeks_falls_back_to_its_pages()
    {
        var chunks = ImportValidation.SplitChunks([
            new AiOutlineChunk("Week 1", "Base", "Intro", 1, 1, 1, 1, 1),
            new AiOutlineChunk("Week 1", "Base", "Intro", 1, 1, 2, 2, 1)
        ]);

        Assert.Equal(["Week 1", "Week 1 (pages 2-2)"], chunks.Select(chunk => chunk.Label));
    }

    [Fact]
    public async Task A_program_whose_blocks_both_end_in_a_deload_is_read_instead_of_refused()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var imports = h.Imports(new SectionHandler(BySection));

        var pending = await imports.Create(Source(), default);
        Assert.Equal(2, pending.ChunksTotal);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, ready.ChunksDone);
        Assert.Equal([1, 2], ready.Draft!.Workouts.Select(day => day.Week));
    }
}
