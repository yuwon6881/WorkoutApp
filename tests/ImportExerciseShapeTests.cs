using System.Net;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A program lists movements it never prescribes sets for — a timed finisher, a conditioning line,
/// a mobility drill written as a sentence — and a dense table runs more sets or more movements into
/// one session than a stored day can carry. Each of those refused the whole section with a message
/// about what "AI returned", and the retry produced the same answer every time. They are brought
/// into the stored shape and reported instead, so nothing the page said is lost and no read that
/// has already been paid for is thrown away.
public sealed class ImportExerciseShapeTests
{
    private const string Outline = """
        {"programTitle":"Nine week block","description":null,"chunks":[
          {"label":"Week 1","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private static string Day(string exercises) => $$"""
        {"programTitle":"Nine week block","description":null,"days":[
          {"block":"Base","phase":"Intro","weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[{{exercises}}]}]}
        """;

    private static string Exercise(string name, string sets) => $$"""
        {"sequenceGroup":"A1","sourceName":"{{name}}","exerciseId":null,"notes":null,"sourcePage":1,"sets":[{{sets}}]}
        """;

    private const string OneSet = """
        {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source() => new("nippard.pdf", 1, [new ImportPageText(1, "WEEK 1\nBench 3x5")]);

    private static StubHandler Reading(params string[] bodies)
    {
        var call = 0;
        return new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(bodies[Math.Min(call++, bodies.Length - 1)])}}}]}]}""")
        });
    }

    [Fact]
    public async Task A_movement_listed_with_no_prescription_is_kept_with_one_unspecified_set()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var imports = h.Imports(Reading(Outline,
            Day($"{Exercise("Barbell bench press", OneSet)},{Exercise("Assault bike finisher", "")}")));

        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var finisher = ready.Draft!.Workouts.Single().Exercises.Single(e => e.SourceName == "Assault bike finisher");
        var set = Assert.Single(finisher.Sets);
        // Nothing is invented beyond the one bound a stored set must have, and it says so.
        Assert.Equal("inferred", set.RepsSource);
        Assert.Null(set.TargetRpe);
        Assert.Null(set.RestSeconds);
        Assert.Contains(ready.ReviewIssues!, issue => issue.Code == "exercise_without_sets" && issue.Message.Contains("Assault bike finisher"));
    }

    [Fact]
    public void An_exercise_with_more_sets_than_one_can_hold_is_trimmed_and_reported()
    {
        var sets = Enumerable.Range(0, 30).Select(_ => new DraftSet(5, 8, 8, 120, null, null, null)).ToList();
        var day = new DraftWorkout(Guid.NewGuid(), 1, "Day A", null, null,
            [new DraftExercise(Guid.NewGuid(), "Bench press", null, null, sets, "A1", [], 1)]);

        var shaped = ImportDayShape.Reconcile([day]);

        Assert.Equal(ImportDayShape.MaxExerciseSets, shaped.Workouts.Single().Exercises.Single().Sets.Count);
        Assert.Equal("exercise_sets_trimmed", Assert.Single(shaped.Notices).Code);
    }

    [Fact]
    public void A_day_with_more_exercises_than_one_can_hold_is_trimmed_and_reported()
    {
        var exercises = Enumerable.Range(0, 45).Select(index => new DraftExercise(
            Guid.NewGuid(), $"Exercise {index}", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)).ToList();
        var day = new DraftWorkout(Guid.NewGuid(), 1, "Day A", null, null, exercises);

        var shaped = ImportDayShape.Reconcile([day]);

        Assert.Equal(ImportDayShape.MaxDayExercises, shaped.Workouts.Single().Exercises.Count);
        Assert.Equal("day_exercises_trimmed", Assert.Single(shaped.Notices).Code);
    }

    /// The fields a read gets wrong one at a time: a page number past the end of the document, a
    /// weekday that is not a weekday, a week beyond what a program counts.
    [Fact]
    public async Task A_slip_in_one_field_is_brought_into_range_rather_than_failing_the_section()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var day = """
            {"programTitle":"Nine week block","description":null,"days":[
              {"block":"Base","phase":"Intro","weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"weekday":9,"sourcePage":4000,"notes":null,"exercises":[
                {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":4000,"sets":[
                  {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"guessed","rpeSource":"extracted","restSource":"extracted","sourcePage":4000}]}]}]}
            """;
        var imports = h.Imports(Reading(Outline, day));

        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var workout = ready.Draft!.Workouts.Single();
        // A weekday that is not a weekday is dropped, and the day then takes its place from the
        // order the document printed rather than failing the import.
        Assert.Equal(1, workout.Weekday);
        Assert.Null(workout.SourcePage);
        Assert.Null(workout.Exercises.Single().SourcePage);
        Assert.Equal("inferred", workout.Exercises.Single().Sets.Single().RepsSource);
    }
}
