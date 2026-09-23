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

    [Fact]
    public async Task A_linked_set_qualifier_and_superset_tag_reach_the_printed_exercise()
    {
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        var imports = Imports(harness);
        var ready = await imports.Extract((await imports.Create(Source([
            new ImportPageLink(1, "Machine Chest Press (Heavy)", "https://youtu.be/qTSTOVVr8rU"),
            new ImportPageLink(1, "A1: Pec Deck (Back off)", "https://youtu.be/2Q1JrK21b4A")
        ]), default)).Id, default);

        var exercises = ready.Draft!.Workouts.SelectMany(day => day.Exercises).ToList();
        Assert.Equal("https://youtu.be/qTSTOVVr8rU", exercises.Single(exercise => exercise.SourceName == "Machine Chest Press").DemoUrl);
        Assert.Equal("https://youtu.be/2Q1JrK21b4A", exercises.Single(exercise => exercise.SourceName == "Pec Deck").DemoUrl);
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

    [Fact]
    public void Known_exercise_reference_hosts_are_accepted_without_opening_arbitrary_sites()
    {
        Assert.Equal("https://exrx.net/WeightExercises/Quadriceps/BBSquat",
            ImportDemoLinks.Video("https://exrx.net/WeightExercises/Quadriceps/BBSquat"));
        Assert.Equal("https://www.roguefitness.com/learn/back-squat",
            ImportDemoLinks.Video("https://www.roguefitness.com/learn/back-squat"));
        Assert.Null(ImportDemoLinks.Video("https://shop.example.com/back-squat"));
    }

    [Fact]
    public void Conflicting_qualified_demonstrations_do_not_choose_one_for_an_unqualified_name()
    {
        var draft = new ImportDraft("Program", [new DraftWorkout(Guid.NewGuid(), 1, "Day 1", null, null,
            [new DraftExercise(Guid.NewGuid(), "Pec Deck", null, null, [new DraftSet(8, 10, 8, 90, null, null, null)])])]);
        var attached = ImportDemoLinks.Attach(draft, [
            new ImportPageLink(1, "Pec Deck (Heavy)", "https://youtu.be/aaa"),
            new ImportPageLink(1, "Pec Deck (Back off)", "https://youtu.be/bbb")
        ]);

        Assert.Null(attached.Workouts[0].Exercises[0].DemoUrl);
    }

    [Fact]
    public void Repeated_name_uses_the_video_on_its_source_page()
    {
        var days = new[] { 1, 2 }.Select(page => new DraftWorkout(Guid.NewGuid(), page, $"Day {page}", null, null,
            [new DraftExercise(Guid.NewGuid(), "Back Squat", null, null,
                [new DraftSet(8, 10, 8, 90, null, null, null)], SourcePage: page)], SourcePage: page)).ToList();
        var attached = ImportDemoLinks.Attach(new ImportDraft("Program", days), [
            new ImportPageLink(1, "Back Squat", "https://youtu.be/aaa"),
            new ImportPageLink(2, "Back Squat", "https://youtu.be/bbb")
        ]);

        Assert.Equal("https://youtu.be/aaa", attached.Workouts[0].Exercises[0].DemoUrl);
        Assert.Equal("https://youtu.be/bbb", attached.Workouts[1].Exercises[0].DemoUrl);
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

    [Fact]
    public async Task Printed_substitution_video_follows_template_swap_and_restore()
    {
        const string original = "Barbell bench press";
        const string alternative = "Flat Smith Machine Bench Press";
        const string originalUrl = "https://youtu.be/original";
        const string alternativeUrl = "https://youtu.be/alternative";
        var source = new ImportDraft("Linked block", [new DraftWorkout(Guid.NewGuid(), 1, "Push", null, null,
            [new DraftExercise(Guid.NewGuid(), original, null, null,
                [new DraftSet(8, 10, 8, 90, null, null, null)], Substitutions: [alternative])])]);
        var attached = ImportDemoLinks.Attach(source, ImportDemoLinks.Normalize([
            new ImportPageLink(1, original, originalUrl),
            new ImportPageLink(1, alternative, alternativeUrl)
        ], 1));
        var linked = attached.Workouts.Single().Exercises.Single();
        Assert.Equal(originalUrl, linked.DemoUrl);
        Assert.Equal(alternativeUrl, ImportDemoLinks.ForName(linked.DemoLinks, alternative));

        await using var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(
            new SeedExercise("bench", original, "Chest", "Barbell", "", null),
            new SeedExercise("smith", alternative, "Chest", "Machine", "", null));
        var bench = await harness.ExerciseId("bench");
        var smith = await harness.ExerciseId("smith");
        var created = await harness.Templates.Create(new TemplateInput("Push", null, null,
            [new TemplateExerciseInput(bench, original, null, [Harness.Set(8, 10)],
                Substitutions: [alternative], DemoUrl: linked.DemoUrl, DemoLinks: linked.DemoLinks)], null, null),
            null, 1, 0, default);
        Assert.Equal(originalUrl, created.Exercises.Single().DemoUrl);

        var swapped = await harness.Templates.Swap(created.Id, new TemplateSubstitutionInput(
            created.Exercises.Single().Id, null, smith, alternative, Revision: created.Revision), default);
        Assert.Equal(alternativeUrl, swapped.Template.Exercises.Single().DemoUrl);

        var restored = await harness.Templates.RestoreSubstitution(created.Id,
            new TemplateSubstitutionRestoreInput(swapped.Template.Exercises.Single().Id, null,
                Revision: swapped.Template.Revision), default);
        Assert.Equal(originalUrl, restored.Template.Exercises.Single().DemoUrl);

        var session = await harness.Workouts.Start(created.Id, null, default);
        Assert.Equal(originalUrl, session.Exercises.Single().DemoUrl);
        var sessionSwap = await harness.Workouts.Swap(session.Id, new SessionSubstitutionInput(
            session.Exercises.Single().Id, smith, alternative, session.Revision, null), default);
        Assert.Equal(alternativeUrl, sessionSwap.Exercises.Single().DemoUrl);
        var sessionRestore = await harness.Workouts.RestoreExercise(session.Id,
            new SessionExerciseRestoreInput(sessionSwap.Exercises.Single().Id, sessionSwap.Revision), default);
        Assert.Equal(originalUrl, sessionRestore.Exercises.Single().DemoUrl);
    }
}
