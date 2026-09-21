using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportAlternativeReconciliationTests
{
    private static Dictionary<string, string?> Configured => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source(string fileName = "test.pdf", int pages = 6)
        => new(fileName, pages, Enumerable.Range(1, pages)
            .Select(page => new ImportPageText(page, $"WEEK {page}\nDay {page}\nBarbell bench press 3 x 8-10 @ RPE 8"))
            .ToList());

    [Fact]
    public void A_prose_only_page_is_unbacked()
    {
        var prosePage = new ImportPageText(1, "Split — There are two different versions of this program:\n5x per week — Upper / Lower / Push / Pull / Arms\n4x per week — Upper / Lower / Push / Pull");
        Assert.False(ImportAlternativeReconciliation.IsSchedulePage(prosePage));

        var tablePage = new ImportPageText(2, "Exercise | Sets | Reps\nBench Press | 3 | 8-10\nIncline DB | 3 | 10-12");
        Assert.True(ImportAlternativeReconciliation.IsSchedulePage(tablePage));

        var weekHeaderPage = new ImportPageText(3, "WEEK 1\nBench Press 3x8");
        Assert.True(ImportAlternativeReconciliation.IsSchedulePage(weekHeaderPage));

        var dayLabelPage = new ImportPageText(4, "DAY LABEL: Upper A\nBench Press 3x8");
        Assert.True(ImportAlternativeReconciliation.IsSchedulePage(dayLabelPage));
    }

    [Fact]
    public void A_subset_single_alternative_is_dropped_and_outcome_chunks_equal_outline_chunks()
    {
        var pages = Source("test.pdf", 4).Pages;
        var outlineChunks = new List<AiOutlineChunk>
        {
            new("Week 1-4", "Block 1", "Phase 1", 1, 4, 1, 4, 4)
        };
        var alternative = new AiAlternative("5x", "5x per week", [
            new("Week 1-4", "Block 1", "Phase 1", 1, 4, 1, 4, 4)
        ]);
        var outline = new AiOutline("Min-Max", outlineChunks, [alternative]);

        var outcome = ImportAlternativeReconciliation.Reconcile(outline, pages);

        Assert.Empty(outcome.Alternatives);
        Assert.Same(outlineChunks, outcome.Chunks);
        var notice = Assert.Single(outcome.Notices);
        Assert.Equal("alternative_without_own_pages", notice.Code);
        Assert.Equal("info", notice.Severity);
    }

    [Fact]
    public void A_single_alternative_covering_extra_pages_is_kept_and_outcome_chunks_emptied()
    {
        var pages = Source("test.pdf", 6).Pages;
        var outlineChunks = new List<AiOutlineChunk>
        {
            new("Week 1-2", "Block 1", "Phase 1", 1, 2, 1, 2, 2)
        };
        var alternative = new AiAlternative("full", "Full Program", [
            new("Week 1-4", "Block 1", "Phase 1", 1, 4, 1, 4, 4)
        ]);
        var outline = new AiOutline("Program", outlineChunks, [alternative]);

        var outcome = ImportAlternativeReconciliation.Reconcile(outline, pages);

        Assert.Single(outcome.Alternatives);
        Assert.Equal("full", outcome.Alternatives[0].Id);
        Assert.Empty(outcome.Chunks);
        var notice = Assert.Single(outcome.Notices);
        Assert.Equal("outline_chunks_ignored", notice.Code);
    }

    [Fact]
    public void Two_dropped_alternatives_produce_exactly_one_notice_naming_both()
    {
        var pages = Source("test.pdf", 4).Pages;
        var outlineChunks = new List<AiOutlineChunk>
        {
            new("Week 1-4", "Block 1", "Phase 1", 1, 4, 1, 4, 4)
        };
        var alt1 = new AiAlternative("4x", "4x per week", []);
        var alt2 = new AiAlternative("3x", "3x per week", [
            new("Week 1-4", "Block 1", "Phase 1", 1, 4, 90, 95, 4) // out of bounds / unbacked
        ]);
        var outline = new AiOutline("Min-Max", outlineChunks, [alt1, alt2]);

        var outcome = ImportAlternativeReconciliation.Reconcile(outline, pages);

        Assert.Empty(outcome.Alternatives);
        Assert.Same(outlineChunks, outcome.Chunks);
        var notice = Assert.Single(outcome.Notices);
        Assert.Equal("alternative_not_in_document", notice.Code);
        Assert.Contains("4x per week", notice.Message);
        Assert.Contains("3x per week", notice.Message);
    }

    [Fact]
    public async Task A_version_the_pdf_only_describes_is_ignored_and_the_printed_schedule_is_imported()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();

        const string outline = """
            {"programTitle":"Min-Max Phase 2","chunks":[
              {"label":"Week 1-4","block":"Block 1","phase":"Hypertrophy","weekFrom":1,"weekTo":4,"pageFrom":1,"pageTo":4,"dayCount":1}
            ],"alternatives":[
              {"id":"5x","name":"5x per week","chunks":[{"label":"Week 1-4","block":"Block 1","phase":"Hypertrophy","weekFrom":1,"weekTo":4,"pageFrom":1,"pageTo":4,"dayCount":1}]},
              {"id":"4x","name":"4x per week","chunks":[]}
            ]}
            """;
        const string chunk = """
            {"programTitle":"Min-Max Phase 2","days":[
              {"block":"Block 1","phase":"Hypertrophy","weekNumber":1,"phaseWeek":1,"dayName":"Upper 1","isRestDay":false,"sourcePage":1,"notes":null,"exercises":[
                {"sequenceGroup":"A1","sourceName":"Barbell Incline Press","exerciseId":null,"warmupSets":null,"workingSets":"1","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[
                  {"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":8,"rir":"2","restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"inferred","restSource":"extracted","sourcePage":1}]}]}]}
            """;

        var call = 0;
        var stub = new StubHandler(_ =>
        {
            var body = call++ == 0 ? outline : chunk;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","usage":{"input_tokens":10,"output_tokens":20},"output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(body)}}}]}]}""")
            };
        });

        var imports = h.Imports(stub);
        var pending = await imports.Create(Source("minmax5x.pdf", 6), default);

        Assert.Equal("extract", pending.Stage);
        Assert.Equal(1, pending.ChunksTotal);
        Assert.Equal("", pending.SelectedAlternativeId);
        var dropNotice = Assert.Single(pending.ReviewIssues!, i => i.Code == "alternative_not_in_document");
        Assert.Contains("4x per week", dropNotice.Message);
        Assert.Equal("info", dropNotice.Severity);

        var ready = await imports.Extract(pending.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Single(ready.Draft!.Workouts);
    }

    [Fact]
    public async Task An_alternative_with_no_pages_is_dropped_and_a_single_backed_alternative_still_collapses()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();

        const string outline = """
            {"programTitle":"Program","chunks":[],"alternatives":[
              {"id":"backed","name":"Backed Version","chunks":[{"label":"Week 1","block":"Block 1","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}]},
              {"id":"ghost","name":"Ghost Version","chunks":[]}
            ]}
            """;

        var stub = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","usage":{"input_tokens":10,"output_tokens":20},"output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(outline)}}}]}]}""")
        });

        var imports = h.Imports(stub);
        var pending = await imports.Create(Source("backed.pdf", 6), default);

        Assert.Equal("extract", pending.Stage);
        Assert.Equal("backed", pending.SelectedAlternativeId);
        Assert.Contains(pending.ReviewIssues ?? [], i => i.Code == "alternative_not_in_document" && i.Message.Contains("Ghost Version"));
    }

    [Fact]
    public async Task Genuinely_separate_routines_still_reach_the_selection_stage()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();

        const string outline = """
            {"programTitle":"Choices","chunks":[],"alternatives":[
              {"id":"full-body","name":"Full Body","chunks":[{"label":"Full Body","block":"Full Body","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}]},
              {"id":"upper-lower","name":"Upper/Lower","chunks":[{"label":"Upper/Lower","block":"Upper/Lower","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}]},
              {"id":"body-part","name":"Body Part Split","chunks":[{"label":"Body Part Split","block":"Body Part Split","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}]}
            ]}
            """;

        var stub = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","usage":{"input_tokens":10,"output_tokens":20},"output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(outline)}}}]}]}""")
        });

        var imports = h.Imports(stub);
        var pending = await imports.Create(Source("choices.pdf", 6), default);

        Assert.Equal("select", pending.Stage);
        Assert.Equal(3, pending.Alternatives!.Count);
        Assert.DoesNotContain(pending.ReviewIssues ?? [], i => i.Code is "alternative_not_in_document" or "alternative_without_own_pages");
    }

    [Fact]
    public async Task Mixed_alternatives_with_their_own_pages_keep_the_selection()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();

        const string outline = """
            {"programTitle":"Mixed","chunks":[
              {"label":"Chunks 1-2","block":"Block 1","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}
            ],"alternatives":[
              {"id":"alt-a","name":"Routine A","chunks":[{"label":"A","block":"A","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}]},
              {"id":"alt-b","name":"Routine B","chunks":[{"label":"B","block":"B","phase":"Base","weekFrom":2,"weekTo":2,"pageFrom":5,"pageTo":6,"dayCount":1}]}
            ]}
            """;

        var stub = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","usage":{"input_tokens":10,"output_tokens":20},"output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(outline)}}}]}]}""")
        });

        var imports = h.Imports(stub);
        var pending = await imports.Create(Source("mixed.pdf", 6), default);

        Assert.Equal("select", pending.Stage);
        Assert.Equal(2, pending.Alternatives!.Count);
        Assert.Contains(pending.ReviewIssues ?? [], i => i.Code == "outline_chunks_ignored");
    }

    [Fact]
    public async Task An_outline_whose_named_versions_are_not_in_the_document_still_fails()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();

        const string outline = """
            {"programTitle":"Ghost","chunks":[],"alternatives":[
              {"id":"ghost","name":"Ghost","chunks":[{"label":"Ghost","block":"Ghost","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":90,"pageTo":95,"dayCount":1}]}
            ]}
            """;

        var stub = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","usage":{"input_tokens":10,"output_tokens":20},"output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(outline)}}}]}]}""")
        });

        var imports = h.Imports(stub);
        var ex = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("ghost.pdf", 6), default));

        Assert.Equal(422, ex.Status);
        Assert.Equal("This PDF names program versions but does not contain their schedules. Import the PDF that holds the schedule you want.", ex.Message);
        Assert.Empty(await h.Db.Imports.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task A_truly_empty_outline_still_fails()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();

        const string outline = """
            {"programTitle":"Empty","chunks":[],"alternatives":[]}
            """;

        var stub = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","usage":{"input_tokens":10,"output_tokens":20},"output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(outline)}}}]}]}""")
        });

        var imports = h.Imports(stub);
        var ex = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("empty.pdf", 6), default));

        Assert.Equal(422, ex.Status);
        Assert.Equal("AI did not find usable program chunks in this PDF.", ex.Message);
    }
}
