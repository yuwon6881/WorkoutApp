using System.Net;
using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Recent Jeff Nippard programs link a demonstration video from every exercise name, as a PDF
/// annotation layer rather than as text — Min-Max Phase 2 carries 2,088 of them and not one URL
/// in its text. The browser reads them from the annotations; everything here is about what the
/// server is willing to accept from that, and where the link ends up.
public sealed class ImportDemoLinkTests
{
    private const string Outline = """
        {"programTitle":"Linked block","chunks":[
          {"label":"Week 1","block":null,"phase":null,"weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private const string Section = """
        {"programTitle":"Linked block","days":[
          {"block":null,"phase":null,"weekNumber":1,"phaseWeek":1,"dayName":"Push #1","isRestDay":false,"notes":null,"sourcePage":1,"exercises":[
            {"sequenceGroup":null,"sourceName":"Machine Chest Press","exerciseId":null,"warmupSets":null,"workingSets":"3","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":8,"rir":null,"restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]},
            {"sequenceGroup":null,"sourceName":"Pec Deck","exerciseId":null,"warmupSets":null,"workingSets":"3","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":8,"rir":null,"restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportService Imports(Harness harness)
    {
        var call = 0;
        var bodies = new[] { Outline, Section };
        return harness.Imports(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(bodies[Math.Min(call++, bodies.Length - 1)])}}}]}]}""")
        }));
    }

    private static ImportSourceInput Source(List<ImportPageLink>? links) => new("min-max.pdf", 1,
        [new ImportPageText(1, "WEEK 1\nMachine Chest Press | 3 | 6-8\nPec Deck | 3 | 6-8")], links);

    [Fact]
    public async Task A_linked_exercise_carries_its_demonstration_into_the_draft()
    {
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        var imports = Imports(harness);

        var ready = await imports.Extract((await imports.Create(Source([
            new ImportPageLink(1, "Machine Chest Press", "https://youtu.be/qTSTOVVr8rU")]), default)).Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var exercises = ready.Draft!.Workouts.SelectMany(day => day.Exercises).ToList();
        Assert.Equal("https://youtu.be/qTSTOVVr8rU",
            exercises.Single(exercise => exercise.SourceName == "Machine Chest Press").DemoUrl);
        // A document links only some of its movements; the rest simply have none.
        Assert.Null(exercises.Single(exercise => exercise.SourceName == "Pec Deck").DemoUrl);
    }

    /// The annotation layer of those same PDFs also carries an affiliate shop and a journal
    /// article. A document is untrusted input and this is a place the app will offer to send
    /// someone, so anything that is not a video link is dropped rather than stored.
    [Theory]
    [InlineData("http://bit.ly/jeffmacrofactorworkouts")]
    [InlineData("https://journals.lww.com/acsm-msse/fulltext/2011/07000/exercise.aspx")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://youtube.com.evil.test/watch?v=1")]
    [InlineData("file:///etc/passwd")]
    public async Task A_link_that_is_not_a_video_is_dropped(string url)
    {
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        var imports = Imports(harness);

        var ready = await imports.Extract((await imports.Create(
            Source([new ImportPageLink(1, "Machine Chest Press", url)]), default)).Id, default);

        Assert.All(ready.Draft!.Workouts.SelectMany(day => day.Exercises), exercise => Assert.Null(exercise.DemoUrl));
    }

    [Fact]
    public void An_http_video_link_is_upgraded_and_a_foreign_host_is_refused()
    {
        Assert.Equal("https://youtu.be/qTSTOVVr8rU", ImportDemoLinks.Video("http://youtu.be/qTSTOVVr8rU"));
        Assert.Equal("https://www.youtube.com/watch?v=bEv6CCg2BC8",
            ImportDemoLinks.Video("https://www.youtube.com/watch?v=bEv6CCg2BC8"));
        Assert.Null(ImportDemoLinks.Video("https://vimeo.com/123"));
        Assert.Null(ImportDemoLinks.Video(null));
    }

    /// A document with no annotation layer is the common case and must be untouched by any of this.
    [Fact]
    public async Task A_document_without_links_imports_exactly_as_before()
    {
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        var imports = Imports(harness);

        var ready = await imports.Extract((await imports.Create(Source(null), default)).Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.All(ready.Draft!.Workouts.SelectMany(day => day.Exercises), exercise => Assert.Null(exercise.DemoUrl));
    }

    [Fact]
    public async Task The_demonstration_survives_into_the_created_program()
    {
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        await harness.Seed(new SeedExercise("machine-chest-press", "Machine Chest Press", "Chest", "Machine", "", null),
            new SeedExercise("pec-deck", "Pec Deck", "Chest", "Machine", "", null));
        var imports = Imports(harness);

        var ready = await imports.Extract((await imports.Create(Source([
            new ImportPageLink(1, "Machine Chest Press", "https://youtu.be/qTSTOVVr8rU")]), default)).Id, default);
        Assert.True(ready.Acceptable);
        var program = await imports.Accept(ready.Id, default);

        var template = await harness.Templates.List(program.Id, false, default);
        var exercises = template.SelectMany(day => day.Exercises).ToList();
        Assert.Equal("https://youtu.be/qTSTOVVr8rU",
            exercises.Single(exercise => exercise.SourceName == "Machine Chest Press").DemoUrl);
        Assert.Null(exercises.Single(exercise => exercise.SourceName == "Pec Deck").DemoUrl);
    }
}
