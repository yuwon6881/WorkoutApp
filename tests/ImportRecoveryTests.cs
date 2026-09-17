using System.Net;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// What happens to an import between passes. The server holds the text the browser extracted for
/// a day, so an interrupted read continues where it stopped instead of asking for the document
/// again — and a finished read keeps the draft while dropping the text it came from.
public sealed class ImportRecoveryTests
{
    private const string Outline = """
        {"programTitle":"Recovery","description":null,"chunks":[
          {"label":"Week 1","block":"Base","phase":"Strength","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private const string TwoChunkOutline = """
        {"programTitle":"Recovery","description":null,"chunks":[
          {"label":"Week 1","block":"Base","phase":"Strength","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1},
          {"label":"Week 2","block":"Base","phase":"Strength","weekFrom":2,"weekTo":2,"pageFrom":2,"pageTo":2,"dayCount":1}]}
        """;

    private static string Day(int week, string name) => $$"""
        {"programTitle":"Recovery","description":null,"days":[
          {"block":"Base","phase":"Strength","weekNumber":{{week}},"phaseWeek":{{week}},"dayName":"{{name}}","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source(int pages = 2) => new("recovery.pdf", pages,
        Enumerable.Range(1, pages).Select(page => new ImportPageText(page, $"WEEK {page}\nBarbell bench press 3 x 5-8 @ RPE 8")).ToList());

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
    public async Task An_outline_that_never_landed_is_retryable_from_the_stored_text()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var call = 0;
        var stub = new StubHandler(_ => call++ == 0
            ? throw new HttpRequestException("network")
            : new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(Outline)}}}]}]}""")
            });
        var imports = h.Imports(stub);
        await Assert.ThrowsAnyAsync<Exception>(() => imports.Create(Source(), default));

        // The failed pass keeps the import and its text: the document does not have to be read again.
        var row = await h.Db.Imports.AsNoTracking().SingleAsync();
        Assert.Equal("outline", row.Stage);
        Assert.NotEqual("", row.SourceTextJson);
        h.Db.ChangeTracker.Clear();

        var resumed = await imports.Retry(row.Id, default);
        Assert.Equal("extract", resumed.Stage);
    }

    [Fact]
    public async Task Submitting_the_same_document_again_continues_the_unfinished_import()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var stub = Reading(Outline, Day(1, "Day A"));
        var imports = h.Imports(stub);
        var pending = await imports.Create(Source(), default);
        Assert.Equal("extract", pending.Stage);

        var again = await imports.Create(Source(), default);
        Assert.Equal(pending.Id, again.Id);
        // Re-submitting costs nothing: the outline it already has is not read a second time.
        Assert.Equal(1, stub.Calls);
    }

    [Fact]
    public async Task A_completed_read_keeps_the_draft_and_drops_the_text_it_came_from()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var imports = h.Imports(Reading(Outline, Day(1, "Day A")));
        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Null(ready.SourceExpiresAt);
        var row = await h.Db.Imports.AsNoTracking().SingleAsync();
        Assert.Equal("", row.SourceTextJson);
        Assert.Null(row.SourceExpiresAt);
        Assert.NotEmpty(row.DraftJson);
    }

    [Fact]
    public async Task An_import_whose_text_has_gone_asks_for_the_document_rather_than_stalling()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var imports = h.Imports(Reading(Outline, Day(1, "Day A")));
        var pending = await imports.Create(Source(), default);

        var row = await h.Db.Imports.SingleAsync();
        row.SourceTextJson = ""; row.SourceExpiresAt = null;
        await h.Db.SaveChangesAsync();
        h.Db.ChangeTracker.Clear();

        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Extract(pending.Id, default));
        Assert.Equal(410, failure.Status);
        Assert.Contains("Choose the same PDF again", failure.Message);
    }

    [Fact]
    public async Task A_rejected_section_keeps_the_sections_before_it_and_stays_retryable()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        // The second section answers with a week that belongs to the first, which is a real
        // extraction error rather than an estimate that drifted. Sections are read together now,
        // so what must survive is the unbroken prefix: section one commits, section two does not.
        var imports = h.Imports(Reading(TwoChunkOutline, Day(1, "Day A"), Day(1, "Day A")));
        var pending = await imports.Create(Source(), default);
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Extract(pending.Id, default));
        Assert.Equal(422, failure.Status);

        var row = await h.Db.Imports.AsNoTracking().SingleAsync();
        Assert.Equal(ImportStatus.Pending, row.Status);
        Assert.Equal(1, row.ChunksDone);
        Assert.NotEqual("", row.SourceTextJson);
        Assert.Equal(1, row.Retries);
    }

    [Fact]
    public async Task A_duplicate_extraction_after_completion_is_acknowledged_without_another_call()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var stub = Reading(Outline, Day(1, "Day A"));
        var imports = h.Imports(stub);
        var pending = await imports.Create(Source(), default);
        await imports.Extract(pending.Id, default);

        var duplicate = await imports.Extract(pending.Id, default);
        Assert.Equal(ImportStatus.Ready, duplicate.Status);
        Assert.Equal(2, stub.Calls);
    }
}
