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
/// every time. What the outline claimed about a section is reconciled with what the section read
/// and reported for review; only a read that genuinely did not happen still fails.
public sealed class ImportReconciliationTests
{
    /// One page, so the section is small enough to read whole and stays exactly as the outline
    /// drew it; what is under test here is the estimate, not how a long section is divided.
    private const string Outline = """
        {"programTitle":"Nine week block","description":null,"chunks":[
          {"label":"Front matter and program explanation","block":"Base","phase":"Intro","weekFrom":1,"weekTo":2,"pageFrom":1,"pageTo":1,"dayCount":15}]}
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

    /// The outline's week range is a claim made from page previews; the page the section actually
    /// read is the better authority. Refusing the section over the disagreement only produced the
    /// same answer on every retry, so the page is followed and the reviewer is told.
    [Fact]
    public async Task A_day_whose_week_falls_outside_the_sections_range_is_kept_and_reported()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 2\nBench 3x5")]);
        var imports = h.Imports(Reading(Outline, Days((9, "Day A"))));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(9, ready.Draft!.Workouts.Single().Week);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "day_outside_section_weeks");
        Assert.Contains("Day A", notice.Message);
        Assert.Equal("warning", notice.Severity);
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
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, ready.ChunksDone);
        Assert.Single(ready.Draft!.Workouts);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "section_without_text");
        Assert.Contains("Photographs", notice.Message);
        // The skipped section costs nothing: only the outline and the one real section were read.
        Assert.Equal(2, stub.Calls);
    }

    /// A coached program routinely lists three or four alternates for one movement. The importer
    /// keeps the two an exercise can hold, so the length of that list must never be the reason a
    /// whole section is rejected — which is what "An exercise can have at most 2 substitutions"
    /// did to the first section of a real import.
    [Fact]
    public async Task An_exercise_offering_more_alternates_than_it_can_hold_is_still_read()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var manyAlternates = """
            {"programTitle":"Nine week block","description":null,"days":[
              {"block":"Base","phase":"Intro","weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
                {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,
                 "substitutions":["Incline dumbbell press","Machine chest press","Push-up","Floor press"],"sets":[
                  {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
            """;
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 2\nBench 3x5")]);
        var imports = h.Imports(Reading(Outline, manyAlternates));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var exercise = ready.Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal(["Incline dumbbell press", "Machine chest press"], exercise.Substitutions);
        // The alternates that do not fit are still written down rather than dropped.
        Assert.Contains("Other alternates: Push-up, Floor press", exercise.Notes);
    }

    /// A program that runs the same session twice in one week, with no weekday printed next to
    /// either, produces two days that read identically. That is what the document says, not a
    /// defect, and refusing the section over it stranded a real import on its third block.
    [Fact]
    public async Task Two_days_that_read_identically_are_both_kept_and_reported()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 2\nBench 3x5")]);
        var imports = h.Imports(Reading(Outline, Days((1, "Conditioning"), (1, "Conditioning"))));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, ready.Draft!.Workouts.Count);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "repeated_day");
        Assert.Contains("delete one in the review", notice.Message);
        // Both cannot hold the same weekday, so the repeat gives up the one it claimed and takes
        // its place in the week's order instead.
        Assert.Single(ready.ReviewIssues!, issue => issue.Code == "weekday_taken");
        Assert.Equal([1, 2], ready.Draft.Workouts.Select(day => day.Weekday));
    }

    /// A section that repeats a day an earlier section already read is the one duplicate worth
    /// acting on: merging it would put the same session in the program twice.
    [Fact]
    public async Task A_day_an_earlier_section_already_read_is_kept_only_once()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var overlapping = """
            {"programTitle":"Nine week block","description":null,"chunks":[
              {"label":"Week 1 pages","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1},
              {"label":"Week 1 continued","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":2,"pageTo":2,"dayCount":1}]}
            """;
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 1\nBench 3x5 again")]);
        var imports = h.Imports(Reading(overlapping, Days((1, "Day A")), Days((1, "Day A"))));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Single(ready.Draft!.Workouts);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "duplicate_day_dropped");
        Assert.Contains("kept once", notice.Message);
    }
}
