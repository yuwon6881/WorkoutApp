using System.Net;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A section is read in one model answer, and one answer holds only so much. A real block — five
/// sessions a week for six weeks, a page each — is thirty days of dense tables, so the read
/// stopped partway through its pages and returned a shorter program that looked complete: valid,
/// never refused, never retried, with two thirds of the weeks simply missing. The outline is now
/// divided into sections small enough for one answer to hold.
public sealed class ImportSectionSizeTests
{
    /// One block of thirty days across thirty pages: what the model drew before it was divided.
    private const string OneLongBlock = """
        {"programTitle":"Six week block","chunks":[
          {"label":"Block 1","block":"Block 1","phase":"Accumulation","weekFrom":1,"weekTo":6,"pageFrom":25,"pageTo":54,"dayCount":30}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source() => new("nippard.pdf", 60,
        Enumerable.Range(1, 60).Select(page => new ImportPageText(page, $"PAGE {page}\nBench 3x5")).ToList());

    private sealed class SectionHandler(Func<string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<string> Directives { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            lock (Directives) Directives.Add(body);
            return respond(body);
        }
    }

    private static HttpResponseMessage Answer(string payload) => new(HttpStatusCode.OK)
    {
        Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(payload)}}}]}]}""")
    };

    /// Each section is asked for its own pages, and answers with one day per page it covers.
    private static HttpResponseMessage BySection(string request)
    {
        if (request.Contains("training_program_outline")) return Answer(OneLongBlock);
        var match = System.Text.RegularExpressions.Regex.Match(request, @"pages (\d+)-(\d+)\.");
        var from = int.Parse(match.Groups[1].Value);
        var to = int.Parse(match.Groups[2].Value);
        var days = Enumerable.Range(from, to - from + 1).Select(page => $$"""
            {"block":"Block 1","phase":"Accumulation","weekNumber":{{Math.Min(6, (page - 25) / 5 + 1)}},"phaseWeek":{{Math.Min(6, (page - 25) / 5 + 1)}},"dayName":"Page {{page}} session","isRestDay":false,"weekday":null,"sourcePage":{{page}},"notes":null,"exercises":[
              {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":{{page}},"sets":[
                {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":{{page}}}]}]}
            """);
        return Answer($$"""{"programTitle":"Six week block","days":[{{string.Join(",", days)}}]}""");
    }

    [Fact]
    public async Task A_block_too_long_for_one_answer_is_read_as_several_sections_covering_every_page()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var handler = new SectionHandler(BySection);
        var imports = h.Imports(handler);

        var pending = await imports.Create(Source(), default);

        // Thirty outlined days at eight days a section, and the pages divide evenly between them.
        Assert.Equal(4, pending.ChunksTotal);

        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        // Every page of the block is read, not just the ones the first answer reached.
        Assert.Equal(Enumerable.Range(25, 30), ready.Draft!.Workouts.Select(day => day.SourcePage!.Value).Order());
    }

    [Fact]
    public void Dividing_keeps_the_pages_whole_the_weeks_intact_and_the_estimate_honest()
    {
        var chunks = ImportValidation.SplitChunks([
            new AiOutlineChunk("Block 1", "Block 1", "Accumulation", 1, 6, 25, 54, 30)
        ]);

        Assert.Equal(4, chunks.Count);
        // Consecutive, gapless, and inside the range the outline drew.
        Assert.Equal(25, chunks[0].PageFrom);
        Assert.Equal(54, chunks[^1].PageTo);
        for (var index = 1; index < chunks.Count; index++)
            Assert.Equal(chunks[index - 1].PageTo + 1, chunks[index].PageFrom);
        // The weeks stay whole on every piece: which pages carry which week is what the outline
        // could not say, so no piece invents an answer to it.
        Assert.All(chunks, chunk => Assert.Equal((1, 6), (chunk.WeekFrom, chunk.WeekTo)));
        // The estimate is divided, not multiplied.
        Assert.Equal(30, chunks.Sum(chunk => chunk.DayCount));
        Assert.All(chunks, chunk => Assert.True(chunk.DayCount <= ImportSections.TargetSectionDays));
        Assert.Equal(chunks.Select(chunk => chunk.Label).Distinct().Count(), chunks.Count);
    }

    [Fact]
    public void A_section_short_enough_to_read_whole_is_left_exactly_as_the_outline_drew_it()
    {
        var chunk = Assert.Single(ImportValidation.SplitChunks([
            new AiOutlineChunk("Deload", "Block 1", "Deload", 7, 7, 55, 56, 5)
        ]));

        Assert.Equal("Deload", chunk.Label);
        Assert.Equal((55, 56), (chunk.PageFrom, chunk.PageTo));
        Assert.Equal(5, chunk.DayCount);
    }

    /// The estimate is wrong in both directions, so it cannot be the only thing that decides how
    /// much a read is asked for: a long stretch of pages is divided even when it claims to be small.
    [Fact]
    public void A_long_section_is_divided_even_when_the_outline_underestimated_its_days()
    {
        var chunks = ImportValidation.SplitChunks([
            new AiOutlineChunk("Front matter and program", "Block 1", "Main", 1, 6, 1, 30, 4)
        ]);

        Assert.Equal(3, chunks.Count);
        Assert.All(chunks, chunk => Assert.True(chunk.PageTo - chunk.PageFrom + 1 <= ImportSections.MaxSectionPages));
        Assert.Equal(1, chunks[0].PageFrom);
        Assert.Equal(30, chunks[^1].PageTo);
        // A day count cannot fall to zero, or the section would claim to hold nothing.
        Assert.All(chunks, chunk => Assert.True(chunk.DayCount >= 1));
    }

    [Fact]
    public void A_dense_page_is_never_cut_below_one_page_a_section()
    {
        var chunks = ImportValidation.SplitChunks([
            new AiOutlineChunk("Whole program", "Block 1", "Main", 1, 8, 12, 13, 40)
        ]);

        Assert.Equal(2, chunks.Count);
        Assert.Equal([(12, 12), (13, 13)], chunks.Select(chunk => (chunk.PageFrom, chunk.PageTo)));
    }
}
