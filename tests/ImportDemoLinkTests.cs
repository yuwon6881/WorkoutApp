using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A demonstration link in an imported file is a place the app will later offer to send someone, so
/// everything here is about what the server is willing to accept and where the link ends up.
public sealed class ImportDemoLinkTests
{
    private static string Exercise(string name, string extra = "")
        => $$"""{"sourceName":"{{name}}"{{extra}},"sets":[{"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":90}]}""";

    [Theory]
    [InlineData("http://bit.ly/jeffmacrofactorworkouts")]
    [InlineData("https://journals.lww.com/acsm-msse/fulltext/2011/07000/exercise.aspx")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://youtube.com.evil.test/watch?v=1")]
    [InlineData("file:///etc/passwd")]
    public async Task A_link_that_is_not_a_video_is_refused(string url)
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var json = ExternalDraftFixture.Weeks(1, exercises: Exercise("Machine Chest Press", $",\"demoUrl\":\"{url}\""));

        await Assert.ThrowsAsync<DomainException>(() => ExternalDraftFixture.Create(harness.Imports(), json));

        Assert.Empty(await harness.Imports().List(default));
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
    public async Task The_demonstration_survives_into_the_created_program()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(new SeedExercise("machine-chest-press", "Machine Chest Press", "Chest", "Machine", null),
            new SeedExercise("pec-deck", "Pec Deck", "Chest", "Machine", null));
        var imports = harness.Imports();

        var ready = await ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(1,
            exercises: Exercise("Machine Chest Press", ",\"demoUrl\":\"https://youtu.be/qTSTOVVr8rU\"") + "," + Exercise("Pec Deck")));
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
        await using var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(
            new SeedExercise("bench", original, "Chest", "Barbell", null),
            new SeedExercise("smith", alternative, "Chest", "Machine", null));
        var imported = await ExternalDraftFixture.Create(harness.Imports(), ExternalDraftFixture.Weeks(1, "Linked block",
            Exercise(original, $",\"substitutions\":[\"{alternative}\"],\"demoUrl\":\"{originalUrl}\",\"demoLinks\":{{\"{alternative}\":\"{alternativeUrl}\"}}")));
        var linked = imported.Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal(originalUrl, linked.DemoUrl);
        Assert.Equal(alternativeUrl, linked.DemoLinks![alternative]);

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
