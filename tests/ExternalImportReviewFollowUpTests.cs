using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Regressions for the review of the ChatGPT-assisted import: batched domain errors, the lenient
/// legacy week choice, review wording kept in step with its source, and harmless uncertainty values.
public sealed class ExternalImportReviewFollowUpTests
{
    private static async Task<ImportService> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null),
            new SeedExercise("squat", "Squat", "Quads", "Barbell", null));
        return h.Imports();
    }

    [Fact]
    public async Task Domain_errors_in_several_exercises_and_days_are_reported_together()
    {
        const string file = """
        {"version":1,"program":{"name":"P","days":[
          {"key":"a","week":1,"name":"A","exercises":[
            {"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10,"rir":"99"}]},
            {"sourceName":"Squat","sets":[{"repMin":8,"repMax":10,"type":"bogus"}]}]},
          {"key":"b","week":1,"name":"B","exercises":[
            {"sourceName":"Row","sets":[]}]}]}}
        """;
        var imports = await Ready();
        var error = await Assert.ThrowsAsync<DomainException>(() => imports.CreateExternalImport(file, "p.json", default));
        var paths = ExternalImportPath.ErrorsOf(error).Select(item => item.Path).ToList();
        Assert.Contains(paths, path => path.StartsWith("$.program.days[0].exercises[0]"));
        Assert.Contains(paths, path => path.StartsWith("$.program.days[0].exercises[1]"));
        Assert.Contains(paths, path => path.StartsWith("$.program.days[1].exercises[0]"));
    }

    [Fact]
    public async Task A_value_the_file_leaves_out_is_not_treated_as_one_the_reader_failed_to_read()
    {
        // The prompt tells the assistant to leave unknown values absent, so absence is the normal case and must
        // not become a blocking "could not be read" item the way a PDF cell the model failed to read does.
        const string file = """
        {"version":1,"program":{"name":"P","days":[
          {"key":"a","week":1,"name":"A","exercises":[
            {"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10}]}]}]}}
        """;
        var imports = await Ready();
        var view = await imports.CreateExternalImport(file, "p.json", default);

        var codes = (view.ReviewIssues ?? []).Select(issue => issue.Code).ToList();
        Assert.DoesNotContain("rest_unread", codes);
        Assert.DoesNotContain("rpe_unread", codes);
        Assert.Contains("rest_unspecified", codes);
        Assert.DoesNotContain(view.ReviewIssues!, issue => issue.Severity == "warning");
        Assert.True(view.Acceptable);
    }

    [Fact]
    public async Task What_the_prompt_tells_the_assistant_to_write_is_accepted_without_review_blockers()
    {
        // Count-only warm-ups, a printed "3/3" rep notation, a top-set row followed by a back-off row of the same
        // lift, and Week 10A/10B as a week choice: the decisions the prompt makes so the user is never asked.
        const string file = """
        {"version":1,"program":{"name":"P","days":[
          {"key":"d1","week":1,"name":"Upper","exercises":[
            {"sourceName":"Bench press","sets":[
              {"type":"warmup","warmup":true},{"type":"warmup","warmup":true},
              {"repMin":5,"repMax":5,"targetRpe":8}]},
            {"sourceName":"Bench press","sets":[{"repMin":8,"repMax":8,"targetRpe":9},{"repMin":8,"repMax":8,"targetRpe":9}]},
            {"sourceName":"Squat","notes":"Optional","sets":[{"repsText":"3/3"}]}]},
          {"key":"rest","week":1,"name":"Rest","isRestDay":true,"exercises":[]},
          {"key":"a","week":10,"name":"Week 10A","exercises":[{"sourceName":"Squat","sets":[{"repMin":5,"repMax":5}]}]},
          {"key":"b","week":10,"name":"Week 10B","exercises":[{"sourceName":"Bench press","sets":[{"repMin":1,"repMax":1}]}]}
        ],"alternativeGroups":[{"id":"w10","kind":"week","members":[
          {"id":"a","name":"Week 10A","dayKeys":["a"]},{"id":"b","name":"Week 10B","dayKeys":["b"]}]}]}}
        """;
        var imports = await Ready();
        var view = await imports.CreateExternalImport(file, "p.json", default);

        // The two week versions are the only thing the app asks the user about.
        Assert.Equal("select", view.Stage);
        var exercises = view.Draft!.Workouts[0].Exercises;
        Assert.Equal(["Bench press", "Bench press", "Squat"], exercises.Select(item => item.SourceName));
        Assert.Equal(2, exercises[0].Sets.Count(set => set.Warmup));
        Assert.All(exercises[0].Sets.Where(set => set.Warmup), set => Assert.Null(set.RepMin));
        var compound = exercises[2].Sets[0];
        Assert.Null(compound.RepMin);
        Assert.Equal("3/3", compound.RepsText);
    }

    [Theory]
    [InlineData("\"demoLinks\":[\"https://youtu.be/abc\"]", "demoLinks", "maps a name to a link")]
    [InlineData("\"demoLinks\":{\"Dumbbell press\":null}", "demoLinks", "remove its empty entry")]
    [InlineData("\"demoLinks\":{\"Dumbbell press\":42}", "demoLinks", "maps a name to a link")]
    [InlineData("\"demoUrl\":[\"https://youtu.be/abc\"]", "demoUrl", "one link")]
    [InlineData("\"substitutions\":\"Dumbbell press\"", "substitutions", "list of names")]
    [InlineData("\"restSeconds\":\"two minutes\"", "restSeconds", "whole number")]
    [InlineData("\"notes\":42", "notes", "must be text")]
    public async Task A_field_of_the_wrong_type_says_what_that_field_should_look_like(string field, string name, string expected)
    {
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Bench press\"," + field + ",\"sets\":[{\"repMin\":8,\"repMax\":10}]}]}]}}";
        var imports = await Ready();
        var error = await Assert.ThrowsAsync<DomainException>(() => imports.CreateExternalImport(file, "p.json", default));

        // The location names the field itself, not a key inside it, and the message names its expected shape.
        Assert.Equal($"$.program.days[0].exercises[0].{name}", ExternalImportPath.PathOf(error));
        Assert.Contains(expected, error.Message);
        Assert.DoesNotContain("JSON field type required by the prompt", error.Message);
    }

    [Fact]
    public async Task A_field_with_no_specific_hint_still_gets_a_plain_message()
    {
        const string file = """{"version":1,"program":{"name":"P","days":[{"key":"a","week":"one","name":"A","exercises":[]}]}}""";
        var imports = await Ready();
        var error = await Assert.ThrowsAsync<DomainException>(() => imports.CreateExternalImport(file, "p.json", default));
        Assert.Equal("$.program.days[0].week", ExternalImportPath.PathOf(error));
        Assert.Contains("whole number", error.Message);
    }

    [Fact]
    public void The_prompt_describes_the_shape_of_the_link_fields()
    {
        Assert.Contains("demoLinks maps", ExternalImportPrompt.Text);
        Assert.Contains("demoUrl is one link", ExternalImportPrompt.Text);
    }

    [Theory]
    [InlineData("5", "5")]
    [InlineData("5.5", "5")]
    [InlineData("4.5", "5+")]
    [InlineData("4", "5+")]
    [InlineData("1", "5+")]
    public async Task An_effort_below_the_supported_rpe_range_becomes_reps_in_reserve_and_keeps_the_printed_value(string rpe, string expectedRir)
    {
        // The document printed it and the assistant reported it faithfully, so the file must be accepted. The app
        // stores easy effort as reps in reserve (the logger shows it as "5+"), not as an RPE below 6.
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Bench press\",\"sets\":[{\"repMin\":8,\"repMax\":10,\"targetRpe\":8},{\"repMin\":8,\"repMax\":10,\"targetRpe\":" + rpe + "}]}]}]}}";
        var view = await (await Ready()).CreateExternalImport(file, "p.json", default);

        var sets = view.Draft!.Workouts[0].Exercises[0].Sets;
        Assert.Equal(8, sets[0].TargetRpe);
        Assert.Null(sets[1].TargetRpe);
        Assert.Equal(expectedRir, sets[1].Rir);
        Assert.Contains($"Printed RPE: {rpe}.", sets[1].Notes);
        Assert.DoesNotContain(view.ReviewIssues!, item => item.Code is "rpe_unread" or "rpe_unspecified" or "effort_instruction_conflict");
        Assert.True(view.Acceptable);
    }

    [Theory]
    [InlineData("8.25", 8.5)]
    [InlineData("8.2", 8)]
    [InlineData("9.75", 10)]
    [InlineData("7.3", 7.5)]
    public async Task An_rpe_between_the_half_points_is_rounded_to_the_nearest_half_and_keeps_the_printed_value(string rpe, double expected)
    {
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Bench press\",\"sets\":[{\"repMin\":8,\"repMax\":10,\"targetRpe\":" + rpe + "}]}]}]}}";
        var view = await (await Ready()).CreateExternalImport(file, "p.json", default);

        var set = view.Draft!.Workouts[0].Exercises[0].Sets[0];
        Assert.Equal(expected, set.TargetRpe);
        Assert.Contains($"Printed RPE: {rpe}.", set.Notes);
        Assert.True(view.Acceptable);
    }

    [Fact]
    public async Task A_reps_in_reserve_value_the_file_states_is_kept_when_the_rpe_is_below_range()
    {
        const string file = """
        {"version":1,"program":{"name":"P","days":[{"key":"a","week":1,"name":"A","exercises":[
          {"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10,"targetRpe":4,"rir":"7"}]}]}]}}
        """;
        var set = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises[0].Sets[0];
        Assert.Equal("7", set.Rir);
        Assert.Null(set.TargetRpe);
    }

    [Theory]
    [InlineData("1-2")]
    [InlineData("3+")]
    [InlineData("0")]
    public async Task A_stated_reps_in_reserve_range_or_floor_counts_as_a_stated_effort(string rir)
    {
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Bench press\",\"sets\":[{\"repMin\":8,\"repMax\":10,\"rir\":\"" + rir + "\"}]}]}]}}";
        var view = await (await Ready()).CreateExternalImport(file, "p.json", default);
        Assert.DoesNotContain(view.ReviewIssues!, item => item.Code is "rpe_unread" or "rpe_unspecified");
        Assert.True(view.Acceptable);
    }

    [Fact]
    public async Task An_effort_that_is_not_a_real_rpe_is_still_refused_with_its_location()
    {
        const string file = """
        {"version":1,"program":{"name":"P","days":[{"key":"a","week":1,"name":"A","exercises":[
          {"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10,"targetRpe":0}]}]}]}}
        """;
        var imports = await Ready();
        var error = await Assert.ThrowsAsync<DomainException>(() => imports.CreateExternalImport(file, "p.json", default));
        Assert.StartsWith("$.program.days[0].exercises[0].sets[0]", ExternalImportPath.PathOf(error));
    }

    [Fact]
    public async Task Program_versions_in_one_file_each_keep_their_own_phase_weeks()
    {
        // Versions of one program (a full run and each phase alone) reuse the week numbers while the phases differ. Numbering phase weeks across the whole file
        // interleaved them and squashed weeks 3 to 6 into "week 2", so each version is numbered by itself.
        string Days(string prefix, string phase) => string.Join(",", Enumerable.Range(1, 4).Select(week =>
            "{\"key\":\"" + prefix + week + "\",\"week\":" + week + ",\"name\":\"A\",\"block\":\"Block 1\",\"phase\":\"" + phase + "\",\"phaseWeek\":" + week
            + ",\"exercises\":[{\"sourceName\":\"Bench press\",\"sets\":[{\"repMin\":8,\"repMax\":10}]}]}"));
        var keys = (string prefix) => string.Join(",", Enumerable.Range(1, 4).Select(week => "\"" + prefix + week + "\""));
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[" + Days("x", "Phase 1") + "," + Days("y", "Phase 2") + "],\"alternativeGroups\":[{\"id\":\"v\",\"kind\":\"program\",\"members\":["
            + "{\"id\":\"one\",\"name\":\"One\",\"dayKeys\":[" + keys("x") + "]},{\"id\":\"two\",\"name\":\"Two\",\"dayKeys\":[" + keys("y") + "]}]}]}}";
        var view = await (await Ready()).CreateExternalImport(file, "p.json", default);

        Assert.Equal([1, 2, 3, 4, 1, 2, 3, 4], view.Draft!.Workouts.Select(day => day.PhaseWeek));
    }

    [Theory]
    [InlineData("dropset", "Two Drop Sets (~25% per)", "Two Drop Sets (~25% per)")]
    [InlineData("myoreps", "Myo-reps", "Myo-reps")]
    [InlineData("lengthenedPartials", "Lengthened Partials (Extend Set)", "Lengthened Partials (Extend Set)")]
    [InlineData("partials", "Long-length Partials (on all reps of the last set)", "Long-length Partials (on all reps of the last set)")]
    [InlineData("dropset", "Reduce the weight 25%", "Reduce the weight 25% — Dropset")]
    public async Task A_set_type_is_named_in_the_set_note_only_when_the_note_does_not_already_say_it(string type, string note, string expected)
    {
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Bench press\",\"sets\":[{\"repMin\":8,\"repMax\":10,\"type\":\"" + type + "\",\"notes\":\"" + note + "\"}]}]}]}}";
        var set = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises[0].Sets[0];
        Assert.Equal(expected, set.Notes);
    }

    [Fact]
    public async Task A_superset_label_reused_for_a_later_pair_in_the_same_day_becomes_its_own_superset()
    {
        // The printed program labels both pairs of a day A1/A2, so the label is reused for a second, separate pair.
        string Row(string name, string group) => "{\"sourceName\":\"" + name + "\"" + (group == "" ? "" : ",\"sequenceGroup\":\"" + group + "\"")
            + ",\"sets\":[{\"repMin\":8,\"repMax\":10}]}";
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + string.Join(",", Row("Bench press", "A"), Row("Squat", "A"), Row("Bench press", ""), Row("Squat", "A"), Row("Bench press", "A"), Row("Squat", "B"), Row("Bench press", "B")) + "]}]}}";
        var rows = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises;

        Assert.Equal(["A", "A", "", "C", "C", "B", "B"], rows.Select(row => row.SequenceGroup));
    }

    [Fact]
    public async Task A_supported_effort_is_left_alone()
    {
        const string file = """
        {"version":1,"program":{"name":"P","days":[{"key":"a","week":1,"name":"A","exercises":[
          {"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10,"targetRpe":6},{"repMin":8,"repMax":10,"targetRpe":9.5}]}]}]}}
        """;
        var sets = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises[0].Sets;
        Assert.Equal([6, 9.5], sets.Select(set => set.TargetRpe!.Value));
        Assert.All(sets, set => Assert.DoesNotContain("Printed RPE", set.Notes ?? ""));
    }

    [Fact]
    public async Task Phases_that_alternate_week_by_week_import_even_when_their_phase_week_counts_across_the_program()
    {
        // "Odd Week" and "Even Week" phases alternate, so each run is one week long. An assistant naturally numbers the
        // phase weeks 1, 2, 3 across the program; that is a numbering convention, not a missing week, and the PDF reader
        // renumbers it the same way. It must neither fail the import nor fail the later program creation.
        string Day(int week, string phase, int phaseWeek)
            => $"{{\"key\":\"d{week}\",\"week\":{week},\"name\":\"W{week}\",\"phase\":\"{phase}\",\"phaseWeek\":{phaseWeek},"
               + "\"exercises\":[{\"sourceName\":\"Bench press\",\"sets\":[{\"repMin\":8,\"repMax\":10}]}]}";
        var days = new[] { Day(1, "Odd Week", 1), Day(2, "Even Week - Upper/Lower", 1), Day(3, "Odd Week", 2),
            Day(4, "Even Week - Upper/Lower", 2), Day(5, "Odd Week", 3), Day(6, "Even Week - Upper/Lower", 3) };
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[" + string.Join(',', days) + "]}}";
        var imports = await Ready();

        var view = await imports.CreateExternalImport(file, "p.json", default);

        // Each one-week run restarts at phase week 1; the absolute weeks stay exactly as the file gave them.
        Assert.Equal([1, 1, 1, 1, 1, 1], view.Draft!.Workouts.Select(day => day.PhaseWeek));
        Assert.Equal([1, 2, 3, 4, 5, 6], view.Draft.Workouts.Select(day => day.Week));
        Assert.True(view.Acceptable);
        var program = await imports.Accept(view.Id, default, view.Revision);
        Assert.Equal(6, program.Workouts.Count);
    }

    [Fact]
    public async Task A_phase_that_really_skips_a_week_is_still_reported_for_review()
    {
        string Day(int week, int phaseWeek)
            => $"{{\"key\":\"d{week}\",\"week\":{week},\"name\":\"W{week}\",\"phase\":\"Build\",\"phaseWeek\":{phaseWeek},"
               + "\"exercises\":[{\"sourceName\":\"Bench press\",\"sets\":[{\"repMin\":8,\"repMax\":10}]}]}";
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[" + string.Join(',', Day(1, 1), Day(2, 2), Day(4, 3)) + "]}}";
        var view = await (await Ready()).CreateExternalImport(file, "p.json", default);
        Assert.Contains(view.ReviewIssues!, issue => issue.Code is "program_week_gap" or "phase_week_gap");
    }

    [Theory]
    [InlineData("30SEC", 30)]
    [InlineData("30 sec", 30)]
    [InlineData("1-2 MIN", 90)]
    [InlineData("3-5 MIN", 240)]
    [InlineData("2 min", 120)]
    public async Task A_printed_rest_without_seconds_gets_its_seconds_as_the_pdf_reader_gives_them(string printed, int expectedSeconds)
    {
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Bench press\",\"sets\":[{\"repMin\":8,\"repMax\":10,\"restText\":\"" + printed + "\"}]}]}]}}";
        var set = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises[0].Sets[0];
        Assert.Equal(expectedSeconds, set.RestSeconds);
        Assert.Equal(printed, set.RestText);
    }

    [Fact]
    public async Task Seconds_the_file_states_win_over_the_printed_rest_text_and_unreadable_text_adds_nothing()
    {
        const string file = """
        {"version":1,"program":{"name":"P","days":[{"key":"a","week":1,"name":"A","exercises":[
          {"sourceName":"Bench press","sets":[
            {"repMin":8,"repMax":10,"restSeconds":100,"restText":"1-2 MIN"},
            {"repMin":8,"repMax":10,"restText":"as long as you need"}]}]}]}}
        """;
        var sets = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises[0].Sets;
        Assert.Equal(100, sets[0].RestSeconds);
        Assert.Null(sets[1].RestSeconds);
        Assert.Equal("as long as you need", sets[1].RestText);
    }

    [Fact]
    public async Task A_set_note_that_repeats_the_exercise_note_is_dropped_and_a_set_specific_one_is_kept()
    {
        const string file = """
        {"version":1,"program":{"name":"P","days":[{"key":"a","week":1,"name":"A","exercises":[
          {"sourceName":"Bench press","notes":"Keep your hips down.","sets":[
            {"repMin":8,"repMax":10,"loadText":"75% 1RM","notes":"Keep your hips down."},
            {"repMin":8,"repMax":10,"notes":"  keep your hips DOWN. "},
            {"repMin":6,"repMax":8,"notes":"Last set: add a pause."}]}]}]}}
        """;
        var sets = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises[0].Sets;
        Assert.Null(sets[0].Notes);
        Assert.Null(sets[1].Notes);
        Assert.Equal("Last set: add a pause.", sets[2].Notes);
        Assert.Equal("75% 1RM", sets[0].LoadText);
    }

    [Fact]
    public async Task An_exercise_can_list_up_to_six_substitutions_for_the_swap_picker()
    {
        string File(int count) => "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Bench press\",\"substitutions\":[" + string.Join(',', Enumerable.Range(1, count).Select(i => $"\"Option {i}\""))
            + "],\"sets\":[{\"repMin\":8,\"repMax\":10}]}]}]}}";
        var ok = await (await Ready()).CreateExternalImport(File(6), "p.json", default);
        Assert.Equal(6, ok.Draft!.Workouts[0].Exercises[0].Substitutions.Count);
        await Assert.ThrowsAsync<DomainException>(async () => await (await Ready()).CreateExternalImport(File(7), "p.json", default));
    }

    [Fact]
    public async Task Every_listed_substitution_survives_program_creation_and_workout_start_for_the_swap_picker()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null));
        var names = new[] { "Dumbbell press", "Machine press", "Push-up", "Cable fly", "Dip" };
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Bench press\",\"substitutions\":[" + string.Join(',', names.Select(name => $"\"{name}\"")) + "],"
            + "\"sets\":[{\"repMin\":8,\"repMax\":10}]}]}]}}";
        var imports = h.Imports();
        var view = await imports.CreateExternalImport(file, "p.json", default);

        await imports.Accept(view.Id, default, view.Revision);

        var saved = await h.Db.TemplateExercises.AsNoTracking().Select(row => row.SubstitutionsJson).ToListAsync();
        Assert.Equal(names, Json.Read<List<string>>(Assert.Single(saved)));
    }

    [Fact]
    public async Task A_value_the_file_states_stays_marked_as_supplied_rather_than_checked()
    {
        const string file = """
        {"version":1,"program":{"name":"P","days":[
          {"key":"a","week":1,"name":"A","exercises":[
            {"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":120}]}]}]}}
        """;
        var imports = await Ready();
        var set = (await imports.CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises[0].Sets[0];
        Assert.Equal("inferred", set.RepsSource);
        Assert.Equal("inferred", set.RpeSource);
        Assert.Equal("inferred", set.RestSource);
    }

    [Fact]
    public async Task A_valid_exercise_next_to_a_bad_one_is_not_reported_and_nothing_is_created()
    {
        const string file = """
        {"version":1,"program":{"name":"P","days":[
          {"key":"a","week":1,"name":"A","exercises":[
            {"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10}]},
            {"sourceName":"Squat","sets":[{"repMin":8,"repMax":10,"rir":"99"}]}]}]}}
        """;
        var h = await Harness.Create();
        await h.SignIn();
        var imports = h.Imports();
        var error = await Assert.ThrowsAsync<DomainException>(() => imports.CreateExternalImport(file, "p.json", default));
        Assert.All(ExternalImportPath.ErrorsOf(error), item => Assert.StartsWith("$.program.days[0].exercises[1]", item.Path));
        Assert.Empty(h.Db.Imports.IgnoreQueryFilters().ToList());
    }

    private static async Task<List<DraftSet>> SetsOf(string exerciseNotes, string setsJson)
    {
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Bench press\",\"notes\":\"" + exerciseNotes + "\",\"sets\":" + setsJson + "}]}]}}";
        var view = await (await Ready()).CreateExternalImport(file, "p.json", default);
        return view.Draft!.Workouts[0].Exercises[0].Sets;
    }

    [Fact]
    public async Task A_pause_on_every_rep_makes_each_working_set_a_pause_set_and_leaves_warm_ups_alone()
    {
        var sets = await SetsOf("Slight 1 second pause at the bottom of each rep.",
            "[{\"type\":\"warmup\",\"warmup\":true},{\"repMin\":8,\"repMax\":10},{\"repMin\":8,\"repMax\":10}]");

        Assert.Null(SetTechniques.Of(sets[0].Notes));
        Assert.All(sets.Skip(1), set => Assert.Equal(SetTechniques.Pause, SetTechniques.Of(set.Notes)));
    }

    [Fact]
    public async Task A_set_that_already_has_another_technique_keeps_it_when_the_exercise_pauses_each_rep()
    {
        var sets = await SetsOf("Pause for 1 second in the stretch of each rep.",
            "[{\"repMin\":8,\"repMax\":10},{\"repMin\":8,\"repMax\":10,\"type\":\"lengthenedPartials\"}]");

        Assert.Equal(SetTechniques.Pause, SetTechniques.Of(sets[0].Notes));
        Assert.Equal(SetTechniques.LengthenedPartials, SetTechniques.Of(sets[1].Notes));
    }

    [Fact]
    public async Task A_note_that_says_not_to_pause_leaves_the_sets_straight()
    {
        var sets = await SetsOf("Do not pause between reps.", "[{\"repMin\":8,\"repMax\":10}]");

        Assert.Null(SetTechniques.Of(sets[0].Notes));
    }

    [Fact]
    public async Task A_21s_set_printed_as_segments_targets_their_total_and_keeps_the_printed_text()
    {
        const string file = """
        {"version":1,"program":{"name":"P","days":[
          {"key":"a","week":1,"name":"A","exercises":[
            {"sourceName":"Bench press","notes":"First 7 reps bottom half of ROM, next 7 reps top half of ROM, last 7 reps full ROM.",
             "sets":[{"repsText":"7/7/7"},{"repsText":"7/7/7"}]}]}]}}
        """;
        var view = await (await Ready()).CreateExternalImport(file, "p.json", default);

        Assert.All(view.Draft!.Workouts[0].Exercises[0].Sets, set =>
        {
            Assert.Equal(21, set.RepMin);
            Assert.Equal(21, set.RepMax);
            Assert.Equal("7/7/7", set.RepsText);
        });
        Assert.DoesNotContain(view.ReviewIssues!, issue => issue.Code == "rep_technique_conflict");
    }

    private static string BlockDays(params (string Block, int Week)[] days)
        => "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[" + string.Join(',', days.Select((day, index) =>
            $"{{\"key\":\"d{index}\",\"week\":{day.Week},\"name\":\"Day {index}\",\"block\":\"{day.Block}\",\"exercises\":[{{\"sourceName\":\"Bench press\",\"sets\":[{{\"repMin\":8,\"repMax\":10}}]}}]}}")) + "]}}";

    [Fact]
    public async Task A_later_block_that_restarts_its_week_numbers_continues_after_the_block_before_it()
    {
        var view = await (await Ready()).CreateExternalImport(
            BlockDays(("Block 1", 1), ("Block 1", 2), ("Block 2", 1), ("Block 2", 2), ("Block 3", 1)), "p.json", default);

        Assert.Equal([1, 2, 3, 4, 5], view.Draft!.Workouts.Select(day => day.Week));
    }

    [Fact]
    public async Task Days_of_different_blocks_inside_one_week_stay_in_that_week()
    {
        var view = await (await Ready()).CreateExternalImport(
            BlockDays(("Strength", 1), ("Size", 1), ("Strength", 2), ("Size", 2)), "p.json", default);

        Assert.Equal([1, 1, 2, 2], view.Draft!.Workouts.Select(day => day.Week));
    }

    private static string Weeks(params int[] daysInEachWeek)
    {
        var days = daysInEachWeek.SelectMany((count, week) => Enumerable.Range(1, count).Select(day =>
            day == count
                ? $"{{\"key\":\"w{week}d{day}\",\"week\":{week + 1},\"name\":\"Rest\",\"isRestDay\":true,\"exercises\":[]}}"
                : $"{{\"key\":\"w{week}d{day}\",\"week\":{week + 1},\"name\":\"Day {day}\",\"exercises\":[{{\"sourceName\":\"Bench press\",\"sets\":[{{\"repMin\":8,\"repMax\":10}}]}}]}}"));
        return "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[" + string.Join(',', days) + "]}}";
    }

    [Fact]
    public async Task A_cycle_longer_than_seven_days_that_every_week_repeats_is_kept_whole_without_being_declared()
    {
        var view = await (await Ready()).CreateExternalImport(Weeks(10, 10), "p.json", default);

        Assert.Equal(10, view.Draft!.SourceWeekDays);
        Assert.DoesNotContain(view.ReviewIssues!, issue => issue.Code == "week_day_overflow");
        Assert.All(view.Draft.Workouts.GroupBy(day => day.Week), week => Assert.Equal(10, week.Count()));
    }

    [Fact]
    public async Task Weeks_of_different_lengths_without_a_declared_cycle_still_report_the_overflow()
    {
        var view = await (await Ready()).CreateExternalImport(Weeks(10, 9), "p.json", default);

        Assert.Null(view.Draft!.SourceWeekDays);
        Assert.Contains(view.ReviewIssues!, issue => issue.Code == "week_day_overflow");
    }

    [Fact]
    public void An_uploaded_group_is_still_held_to_a_strict_day_map()
    {
        DraftWorkout Day(string name) => new(Guid.NewGuid(), 1, name, null, null, []);
        var first = Day("A");
        var draft = new ImportDraft("P", [first]) with
        {
            AlternativeGroups = [new("g", [
                new ImportAlternative("x", "X", 2, DayLineIds: [first.LineId, Guid.NewGuid()]),
                new ImportAlternative("y", "Y", 1, DayLineIds: [Guid.NewGuid()])])]
        };
        Assert.Throws<DomainException>(() => ImportDraftAlternatives.Select(draft, "x", "g"));
    }

    [Fact]
    public void An_unflagged_uncertainty_with_a_reason_is_accepted()
        => ImportUncertainty.Validate(new ImportUncertainty(false, "Clearly printed."));

    [Fact]
    public void Every_reworded_fragment_still_appears_in_the_pdf_messages_it_rewrites()
    {
        var api = FindApiFolder();
        var sources = Directory.EnumerateFiles(api, "*.cs", SearchOption.AllDirectories)
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                && !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                && !path.EndsWith("ExternalReviewWording.cs", StringComparison.Ordinal))
            .Select(File.ReadAllText).ToList();
        var stale = ExternalReviewWording.Replacements.Where(item => !sources.Any(text => text.Contains(item.From, StringComparison.Ordinal)))
            .Select(item => item.From).ToList();
        Assert.True(stale.Count == 0, "These fragments no longer appear in any API message, so JSON imports would show PDF wording: "
            + string.Join("; ", stale));
    }

    private static string FindApiFolder()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "api", "Services");
            if (Directory.Exists(candidate)) return Path.Combine(directory.FullName, "api");
        }
        throw new InvalidOperationException("The api folder was not found.");
    }
}
