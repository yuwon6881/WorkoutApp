using System.Net;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A real training PDF says things the stored shape cannot hold exactly: a timed hold with no rep
/// count, a range written high to low, a paragraph of coaching longer than a note column, an RPE
/// with a stray decimal. Every one of those used to fail the whole section with a message about
/// what "AI returned", stranding an import on a section that failed identically on every retry.
/// The values are brought into range instead, and labelled so the review screen shows which
/// numbers did not come straight from the page.
public sealed class ImportNormalizationTests
{
    private const string Outline = """
        {"programTitle":"Nine week block","chunks":[
          {"label":"Week 1","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private static string Day(string exercise, string sets) => $$"""
        {"programTitle":"Nine week block","days":[
          {"block":"Base","phase":"Intro","weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
            {{{exercise}},"sets":[{{sets}}]}]}]}
        """;

    private const string PlainExercise = """
        "sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1
        """;

    private static string Set(string overrides) => $$"""
        {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,
         "repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1,{{overrides}}}
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
        return new StubHandler(_ =>
        {
            var body = bodies[Math.Min(call++, bodies.Length - 1)];
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(body)}}}]}]}""")
            };
        });
    }

    private static async Task<DraftSet> ReadSet(Harness h, string setJson)
    {
        var imports = h.Imports(Reading(Outline, Day(PlainExercise, setJson)));
        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        return ready.Draft!.Workouts.Single().Exercises.Single().Sets.Single();
    }

    [Fact]
    public async Task A_timed_or_amrap_row_with_no_rep_count_is_read_and_labelled_inferred()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var set = await ReadSet(h, Set("""
            "repMin":0,"repMax":0,"repsText":"30 sec hold"
            """.Replace("\n", " ")));

        Assert.Equal(1, set.RepMin);
        Assert.Equal(1, set.RepMax);
        Assert.Equal("inferred", set.RepsSource);
        // What the page said is preserved exactly; only the planning bound was invented.
        Assert.Equal("30 sec hold", set.RepsText);
    }

    [Fact]
    public async Task A_rep_range_written_high_to_low_is_ordered_rather_than_refused()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var set = await ReadSet(h, Set("""
            "repMin":12,"repMax":8,"repsText":"12-8"
            """.Replace("\n", " ")));

        Assert.Equal(8, set.RepMin);
        Assert.Equal(12, set.RepMax);
        Assert.Equal("inferred", set.RepsSource);
    }

    [Fact]
    public async Task A_single_pdf_rep_count_becomes_the_minimum_and_maximum()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var set = await ReadSet(h, Set("""
            "repMin":8,"repMax":12,"repsText":"6"
            """.Replace("\n", " ")));

        Assert.Equal(6, set.RepMin);
        Assert.Equal(6, set.RepMax);
    }

    [Fact]
    public async Task A_rest_range_uses_its_average_in_seconds()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var set = await ReadSet(h, Set("""
            "restSeconds":60,"restText":"1 - 2 minute"
            """.Replace("\n", " ")));

        Assert.Equal(90, set.RestSeconds);
        Assert.Equal("1 - 2 minute", set.RestText);
    }

    [Fact]
    public async Task A_rest_range_with_rest_word_averages_to_minutes_in_seconds()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var set = await ReadSet(h, Set("""
            "restSeconds":null,"restText":"1-3 rest"
            """.Replace("\n", " ")));

        Assert.Equal(120, set.RestSeconds);
        Assert.Equal("1-3 rest", set.RestText);
    }

    [Fact]
    public async Task A_bare_rest_range_averages_to_minutes_in_seconds()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var set = await ReadSet(h, Set("""
            "restSeconds":60,"restText":"1-3"
            """.Replace("\n", " ")));

        Assert.Equal(120, set.RestSeconds);
        Assert.Equal("1-3", set.RestText);
    }

    [Fact]
    public async Task A_bare_decimal_rest_with_model_fallback_uses_the_fallback()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var set = await ReadSet(h, Set("""
            "restSeconds":90,"restText":"1.5"
            """.Replace("\n", " ")));

        Assert.Equal(90, set.RestSeconds);
        Assert.Equal("1.5", set.RestText);
    }

    [Fact]
    public async Task A_bare_small_number_rest_without_fallback_assumes_minutes()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var set = await ReadSet(h, Set("""
            "restSeconds":null,"restText":"2.0"
            """.Replace("\n", " ")));

        Assert.Equal(120, set.RestSeconds);
        Assert.Equal("2.0", set.RestText);
    }

    [Fact]
    public async Task A_superset_prefix_and_hyperlink_are_stripped_from_the_exercise_name()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var exercise = """
            "sequenceGroup":null,"sourceName":"A1: Barbell bench press https://youtu.be/demo123","exerciseId":null,"notes":null,"sourcePage":1
            """;
        var imports = h.Imports(Reading(Outline, Day(exercise, Set("\"tempo\":null"))));
        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var ex = ready.Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal("Barbell bench press", ex.SourceName);
        Assert.Equal("A1", ex.SequenceGroup);
        Assert.NotNull(ex.Notes);
        Assert.Contains("https://youtu.be/demo123", ex.Notes);
    }

    [Fact]
    public async Task An_rpe_off_the_half_point_scale_is_snapped_and_labelled()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var set = await ReadSet(h, Set("""
            "targetRpe":8.3
            """.Replace("\n", " ")));

        Assert.Equal(8.5, set.TargetRpe);
        Assert.Equal("inferred", set.RpeSource);
    }

    [Fact]
    public async Task A_rest_longer_than_a_set_can_hold_is_brought_into_range()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var set = await ReadSet(h, Set("""
            "restSeconds":7200,"restText":"2 hours"
            """.Replace("\n", " ")));

        Assert.Equal(3600, set.RestSeconds);
        Assert.Equal("inferred", set.RestSource);
        Assert.Equal("2 hours", set.RestText);
    }

    [Fact]
    public async Task A_coaching_note_longer_than_its_column_is_trimmed_rather_than_rejected()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var essay = new string('a', 1500);
        var exercise = $"""
            "sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"coachingNotes":"{essay}","sourcePage":1
            """;
        var imports = h.Imports(Reading(Outline, Day(exercise, Set("\"tempo\":null"))));
        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var note = ready.Draft!.Workouts.Single().Exercises.Single().Notes;
        Assert.NotNull(note);
        Assert.True(note!.Length <= 1000);
    }

    [Fact]
    public async Task A_day_the_model_left_unnamed_still_reaches_the_review_screen()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var unnamed = Day(PlainExercise, Set("\"tempo\":null")).Replace("\"dayName\":\"Day A\"", "\"dayName\":\"\"");
        var imports = h.Imports(Reading(Outline, unnamed));
        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal("Week 1 day 1", ready.Draft!.Workouts.Single().Name);
    }

    [Fact]
    public void Normalization_reports_whether_a_value_had_to_move()
    {
        Assert.Equal((5, 8, false), ImportNormalization.Reps(5, 8));
        Assert.Equal((8, 12, true), ImportNormalization.Reps(12, 8));
        Assert.Equal((1, 1, true), ImportNormalization.Reps(0, 0));
        Assert.Equal((1000, 1000, true), ImportNormalization.Reps(5000, 5000));
        Assert.Equal((6, 6, true), ImportNormalization.Reps(6, 8, "6"));
        Assert.Equal((6, 8, true), ImportNormalization.Reps(8, 6, "6-8"));
        Assert.Equal((6, 6, false), ImportNormalization.Reps(6, 6, "6"));
        Assert.Equal((1, 1, true), ImportNormalization.Reps(8, 12, "0"));
        Assert.Equal((8.0, false), ImportNormalization.Rpe(8));
        Assert.Equal((6.0, true), ImportNormalization.Rpe(5));
        Assert.Equal((10.0, true), ImportNormalization.Rpe(12));
        Assert.Equal((null, false), ImportNormalization.Rpe(null));
        Assert.Equal((120, false), ImportNormalization.Rest(120));
        Assert.Equal((0, true), ImportNormalization.Rest(-5));
        Assert.Null(ImportNormalization.Text("   ", 10));
        Assert.Equal("abc", ImportNormalization.Text("abcdef", 3));
        Assert.Equal("fallback", ImportNormalization.Label(null, 10, "fallback"));
    }
}
