using System.Net;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The outline estimates each section's size from page previews, and an estimate made that way is
/// regularly wrong — a section headed "Front matter and program explanation" reads as fifteen
/// training days and contains seven. Rejecting the section over that number threw away a read the
/// user had already paid for and left the import stuck on a chunk that would fail the same way
/// every time. The count is now reconciled and reported; only a genuinely inconsistent section
/// still fails.
public sealed class ImportReconciliationTests
{
    private const string Outline = """
        {"programTitle":"Nine week block","description":null,"chunks":[
          {"label":"Front matter and program explanation","block":"Base","phase":"Intro","weekFrom":1,"weekTo":2,"pageFrom":1,"pageTo":2,"dayCount":15}]}
        """;

    private const string OutlineOverTwoPages = """
        {"programTitle":"Nine week block","description":null,"chunks":[
          {"label":"Week 1","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1},
          {"label":"Photographs","block":"Base","phase":"Intro","weekFrom":2,"weekTo":2,"pageFrom":3,"pageTo":3,"dayCount":4}]}
        """;

    private static string Days(params (int Week, string Name)[] days) => $$"""
        {"programTitle":"Nine week block","description":null,"days":[{{string.Join(",", days.Select(day => $$"""
          {"block":"Base","phase":"Intro","weekNumber":{{day.Week}},"phaseWeek":{{day.Week}},"dayName":"{{day.Name}}","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}
        """))}}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static StubHandler Reading(params string[] bodies)
    {
        var call = 0;
        return new StubHandler(_ =>
        {
            var body = bodies[Math.Min(call++, bodies.Length - 1)];
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(body)}}}]}]}""")
            };
        });
    }

    [Fact]
    public async Task A_section_that_reads_shorter_than_the_outline_estimated_is_kept_and_reported()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 2\nBench 3x5")]);
        var imports = h.Imports(Reading(Outline, Days((1, "Day A"), (2, "Day B"))));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, ready.Draft!.Workouts.Count);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "chunk_day_count");
        Assert.Contains("about 15 days but reads as 2", notice.Message);
        Assert.Equal("warning", notice.Severity);
        Assert.True(ready.Acceptable);
    }

    [Fact]
    public async Task A_day_outside_the_sections_weeks_is_still_a_failure_worth_retrying()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 2\nBench 3x5")]);
        var imports = h.Imports(Reading(Outline, Days((9, "Day A"))));

        var pending = await imports.Create(source, default);
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Extract(pending.Id, default));
        Assert.Equal(422, failure.Status);
        Assert.Contains("outside the week range", failure.Message);
        Assert.Equal(0, (await h.Db.Imports.AsNoTracking().SingleAsync()).ChunksDone);
    }

    [Fact]
    public async Task A_section_whose_pages_hold_no_text_is_skipped_with_a_note_instead_of_stalling()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        // Page 3 is a photo spread: the browser found no text there, so it was never submitted.
        var source = new ImportSourceInput("nippard.pdf", 3, [new ImportPageText(1, "WEEK 1\nBench 3x5")]);
        var stub = Reading(OutlineOverTwoPages, Days((1, "Day A")));
        var imports = h.Imports(stub);

        var pending = await imports.Create(source, default);
        var afterFirst = await imports.Extract(pending.Id, default);
        Assert.Equal(1, afterFirst.ChunksDone);

        var ready = await imports.Extract(pending.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Single(ready.Draft!.Workouts);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "section_without_text");
        Assert.Contains("Photographs", notice.Message);
        // The skipped section costs nothing: only the outline and the one real section were read.
        Assert.Equal(2, stub.Calls);
    }
}
