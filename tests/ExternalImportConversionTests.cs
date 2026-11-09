using System.Text.Json.Nodes;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ExternalImportConversionTests
{
    private const string Fixture = """
    {"version":1,"verified":true,"program":{"name":"Strength","sourceWeekDays":10,"days":[
      {"key":"upper","week":1,"name":"Upper","block":"Base","phase":"Build","phaseWeek":1,
       "sourceReference":{"kind":"sheetCell","sheet":"Plan","cell":"A1:B2"},"exercises":[
        {"sourceName":"Bench press","exerciseId":"00000000-0000-0000-0000-000000000001","lineId":"00000000-0000-0000-0000-000000000002",
         "sequenceGroup":"A","substitutions":["Dumbbell press"],"notes":"Controlled","demoUrl":"https://youtu.be/abc123","demoLinks":{"Dumbbell press":"https://youtu.be/def456"},
         "sourceReference":{"kind":"pdfPage","page":2},"uncertainty":{"flag":true,"reason":"Check load"},
         "sets":[{"repMin":8,"repMax":10,"targetRpe":8,"rir":"2","restSeconds":120,"tempo":"3-0-1","loadText":"70%","notes":"Slow","repsText":"8-10","restText":"2 min","warmup":false,
                  "sourceReference":{"kind":"text","text":"Table 1"},"uncertainty":{"flag":true,"reason":"Check reps"}}]},
        {"sourceName":"Squat","sequenceGroup":"A","sets":[{"type":"dropset","repMin":5,"repMax":5,"targetRpe":8,"restSeconds":90}]}]},
      {"key":"rest-a","week":1,"name":"Rest A","phaseWeek":1,"isRestDay":true,"exercises":[]},
      {"key":"rest-b","week":1,"name":"Rest B","phaseWeek":1,"isRestDay":true,"exercises":[]}
    ],"alternativeGroups":[{"id":"week-choice","kind":"week","members":[
      {"id":"a","name":"Option A","dayKeys":["rest-a"],"uncertainty":{"flag":true,"reason":"Check option"}},
      {"id":"b","name":"Option B","dayKeys":["rest-b"]}]}]}}
    """;

    private static async Task<Harness> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null));
        await h.Seed(new SeedExercise("squat", "Squat", "Quads", "Barbell", null));
        return h;
    }

    [Theory]
    [InlineData("structure", "$.program.days[0].exercises[0].sets")]
    [InlineData("domain", "$.program.days[0].exercises[0].sets[0].rir")]
    [InlineData("reference", "$.program.days[0].exercises[0].sourceReference")]
    [InlineData("limit", "$.program.days[0].exercises[0].substitutions")]
    [InlineData("alternative", "$.program.alternativeGroups[0].members[0].dayKeys")]
    [InlineData("required", "$.program.days[0].exercises[0].sourceName")]
    [InlineData("unknown", "$.program.days[0].exercises[0].unexpected")]
    [InlineData("day-name", "$.program.days[0].name")]
    [InlineData("exercise-notes", "$.program.days[0].exercises[0].notes")]
    [InlineData("overlap", "$.program.alternativeGroups[0].members[1].dayKeys")]
    [InlineData("rir-text", "$.program.days[0].exercises[0].sets[0].rir")]
    [InlineData("no-sets", "$.program.days[0].exercises[0].sets")]
    [InlineData("demo", "$.program.days[0].exercises[0].demoLinks")]
    [InlineData("set-type", "$.program.days[0].exercises[0].sets[0].type")]
    public async Task Invalid_fields_report_where_and_how_to_fix_them(string family, string path)
    {
        var root = JsonNode.Parse(Fixture)!;
        var exercise = root["program"]!["days"]![0]!["exercises"]![0]!;
        switch (family)
        {
            case "structure": exercise["sets"] = "wrong"; break;
            case "domain": exercise["sets"]![0]!["rir"] = "99"; break;
            case "reference": exercise["sourceReference"]!["page"] = 0; break;
            case "limit": exercise["substitutions"] = new JsonArray("one", "two", "three", "four", "five", "six", "seven"); break;
            case "alternative": root["program"]!["alternativeGroups"]![0]!["members"]![0]!["dayKeys"]![0] = "absent"; break;
            case "required": exercise.AsObject().Remove("sourceName"); break;
            case "unknown": exercise["unexpected"] = 3; break;
            case "day-name": root["program"]!["days"]![0]!["name"] = ""; break;
            case "exercise-notes": exercise["notes"] = new string('x', 1001); break;
            case "overlap": root["program"]!["alternativeGroups"]![0]!["members"]![1]!["dayKeys"]![0] = "rest-a"; break;
            case "rir-text": exercise["sets"]![0]!["rir"] = "2 RIR"; break;
            case "no-sets": exercise["sets"] = new JsonArray(); break;
            case "demo": exercise["demoLinks"]!["Dumbbell press"] = "https://example.com/video"; break;
            case "set-type": exercise["sets"]![0]!["type"] = "mystery"; break;
        }
        await using var h = await Ready();
        var error = await Assert.ThrowsAsync<DomainException>(() => h.Imports(StubHandler.Program("{}"))
            .CreateExternalImport(root.ToJsonString(), "program.json", default));
        Assert.Equal(path, error.Data["path"]);
        Assert.False(string.IsNullOrWhiteSpace(error.Message));
        var expectedMessage = family switch
        {
            "structure" => "list", "domain" => "numeric RIR", "reference" => "Correct the source reference",
            "limit" => "at most 6 substitutions", "alternative" => "day keys", "required" => "required",
            "unknown" => "Remove the unsupported", "demo" => "approved host", "set-type" => "Choose a supported set type", _ => null
        };
        if (expectedMessage is not null) Assert.Contains(expectedMessage, error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await h.Imports(StubHandler.Program("{}")).List(default));
    }

    [Fact]
    public async Task Converts_capabilities_into_a_reviewable_draft_with_server_owned_ids()
    {
        await using var h = await Ready();
        var imports = h.Imports(StubHandler.Program("{}"));
        var view = await imports.CreateExternalImport(Fixture, "program.json", default);
        Assert.Equal(ImportStatus.Pending, view.Status);
        Assert.Equal("select", view.Stage);
        Assert.Contains(view.ReviewIssues!, issue => issue.Code == "external_source_unverified");
        var draft = view.Draft!;
        Assert.Equal(10, draft.SourceWeekDays);
        Assert.Equal(("Base", "Build", 1), (draft.Workouts[0].Block, draft.Workouts[0].Phase, draft.Workouts[0].PhaseWeek));
        Assert.Equal("sheetCell", draft.Workouts[0].SourceReference!.Kind);
        var exercise = draft.Workouts[0].Exercises[0];
        Assert.Equal(await h.ExerciseId("bench"), exercise.ExerciseId);
        Assert.NotEqual(Guid.Parse("00000000-0000-0000-0000-000000000002"), exercise.LineId);
        Assert.Equal("pdfPage", exercise.SourceReference!.Kind);
        Assert.Equal("Dumbbell press", Assert.Single(exercise.Substitutions!));
        Assert.NotNull(exercise.DemoUrl);
        Assert.Single(exercise.DemoLinks!);
        var set = Assert.Single(exercise.Sets);
        Assert.Equal((8, 10, 8.0, "2", 120, "3-0-1", "70%"),
            (set.RepMin, set.RepMax, set.TargetRpe, set.Rir, set.RestSeconds, set.Tempo, set.LoadText));
        Assert.True(set.Uncertainty!.Flag);
        Assert.Equal("text", set.SourceReference!.Kind);
        Assert.Equal("A", draft.Workouts[0].Exercises[1].SequenceGroup);
        Assert.Contains("Dropset", draft.Workouts[0].Exercises[1].Sets[0].Notes);
        Assert.Equal(2, Assert.Single(draft.AlternativeGroups!).Members.Count);
    }

    [Theory]
    [InlineData("negative-reps", "reps")]
    [InlineData("bad-rir", "RIR")]
    [InlineData("duplicate-day", "duplicate")]
    [InlineData("dangling-alternative", "day")]
    [InlineData("dangling-superset", "superset")]
    [InlineData("invalid-ref", "source")]
    [InlineData("duplicate-alternative", "duplicate")]
    [InlineData("unknown-field", "unsupported")]
    [InlineData("missing-uncertainty-flag", "uncertainty")]
    [InlineData("separated-superset", "consecutive")]
    public async Task Invalid_documents_fail_without_creating_a_draft_or_program(string mutation, string expected)
    {
        var root = JsonNode.Parse(Fixture)!;
        var days = root["program"]!["days"]!.AsArray();
        var exercise = days[0]!["exercises"]![0]!;
        switch (mutation)
        {
            case "negative-reps": exercise["sets"]![0]!["repMin"] = -1; break;
            case "bad-rir": exercise["sets"]![0]!["rir"] = "99"; break;
            case "duplicate-day": days[1]!["key"] = "upper"; break;
            case "dangling-alternative": root["program"]!["alternativeGroups"]![0]!["members"]![0]!["dayKeys"]![0] = "missing"; break;
            case "dangling-superset": days[0]!["exercises"]![1]!["sequenceGroup"] = ""; break;
            case "invalid-ref": exercise["sourceReference"]!["page"] = 0; break;
            case "duplicate-alternative": root["program"]!["alternativeGroups"]![0]!["members"]![1]!["id"] = "a"; break;
            case "unknown-field": exercise["unhandledPrescription"] = "not discarded"; break;
            case "missing-uncertainty-flag": exercise["uncertainty"]!.AsObject().Remove("flag"); break;
            case "separated-superset":
                var extra = days[0]!["exercises"]![1]!.DeepClone();
                extra["sequenceGroup"] = "";
                days[0]!["exercises"]!.AsArray().Insert(1, extra);
                break;
        }
        await using var h = await Ready();
        var imports = h.Imports(StubHandler.Program("{}"));
        var error = await Assert.ThrowsAsync<DomainException>(() => imports.CreateExternalImport(root.ToJsonString(), "program.json", default));
        Assert.Contains(expected, error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await imports.List(default));
        Assert.Empty(await h.Programs.List(default));
    }

    [Fact]
    public async Task Oversized_input_creates_no_work()
    {
        await using var h = await Ready();
        var imports = h.Imports(StubHandler.Program("{}"));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.CreateExternalImport(new string(' ', ExternalImportEnvelope.MaxBytes + 1), "large.json", default));
        Assert.Equal(413, failure.Status);
        Assert.Empty(await imports.List(default));
        Assert.Empty(await h.Programs.List(default));
    }

    [Fact]
    public async Task Unknown_prescriptions_stay_missing_and_unmatched_exercises_stay_unresolved()
    {
        var root = JsonNode.Parse(Fixture)!;
        var exercise = root["program"]!["days"]![0]!["exercises"]![0]!;
        exercise["sourceName"] = "An unrecognised movement";
        exercise["sets"]![0]!["repMin"] = null;
        exercise["sets"]![0]!["repMax"] = null;
        exercise["sets"]![0]!["repsText"] = "AMRAP";
        exercise["sets"]![0]!["rir"] = "2-3";
        exercise["sets"]![0]!["restSeconds"] = null;
        await using var h = await Ready();
        var imports = h.Imports(StubHandler.Program("{}"));
        var view = await imports.CreateExternalImport(root.ToJsonString(), "program.json", default);
        var actual = view.Draft!.Workouts[0].Exercises[0];
        Assert.Null(actual.ExerciseId);
        Assert.Null(actual.Sets[0].RepMin);
        Assert.Equal("AMRAP", actual.Sets[0].RepsText);
        Assert.Equal("2-3", actual.Sets[0].Rir);
        Assert.Contains(view.Unresolved, item => item.SourceName == "An unrecognised movement");
        Assert.DoesNotContain(view.ReviewIssues!, issue => issue.Message.Contains("PDF", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Program_alternatives_use_server_generated_group_and_member_ids()
    {
        var root = JsonNode.Parse(Fixture)!;
        root["program"]!["alternativeGroups"]![0]!["kind"] = "program";
        await using var h = await Ready();
        var imports = h.Imports(StubHandler.Program("{}"));
        var view = await imports.CreateExternalImport(root.ToJsonString(), "program.json", default);
        var group = Assert.Single(view.Draft!.AlternativeGroups!);
        Assert.NotEqual("week-choice", group.Id);
        Assert.All(group.Members, member => Assert.NotEqual("a", member.Id));
        var selected = await imports.SelectAlternative(view.Id, group.Members[0].Id, default, group.Id);
        Assert.Equal(ImportStatus.Ready, selected.Status);
    }

    [Fact]
    public async Task Ten_day_cycle_survives_review_and_program_creation()
    {
        var root = JsonNode.Parse(Fixture)!;
        var program = root["program"]!;
        program.AsObject().Remove("alternativeGroups");
        var days = program["days"]!.AsArray();
        while (days.Count > 1) days.RemoveAt(days.Count - 1);
        for (var index = 1; index < 10; index++)
            days.Add(new JsonObject { ["key"] = $"rest-{index}", ["week"] = 1, ["phaseWeek"] = 1,
                ["name"] = $"Rest {index}", ["isRestDay"] = true, ["exercises"] = new JsonArray() });
        await using var h = await Ready();
        var imports = h.Imports(StubHandler.Program("{}"));
        var view = await imports.CreateExternalImport(root.ToJsonString(), "cycle.json", default);
        Assert.Equal(10, view.Draft!.SourceWeekDays);
        var result = await imports.Accept(view.Id, default, view.Revision, acknowledgeUncertainty: true);
        Assert.Equal(10, result.Workouts.Count);
        Assert.Equal(9, result.Workouts.Count(day => day.IsRestDay));
    }

    [Theory]
    [InlineData("{\"version\":1,")]
    [InlineData("{\"version\":99,\"program\":{}}")]
    [InlineData("{\"version\":1,\"program\":{\"name\":\"x\"}}")]
    public async Task Invalid_envelopes_are_atomic(string input)
    {
        await using var h = await Ready();
        var imports = h.Imports(StubHandler.Program("{}"));
        await Assert.ThrowsAsync<DomainException>(() => imports.CreateExternalImport(input, "program.json", default));
        Assert.Empty(await imports.List(default));
        Assert.Empty(await h.Programs.List(default));
    }

    [Theory]
    [InlineData("week")]
    [InlineData("program")]
    public async Task Converted_draft_can_be_selected_edited_acknowledged_and_accepted(string kind)
    {
        await using var h = await Ready();
        var imports = h.Imports(StubHandler.Program("{}"));
        var root = JsonNode.Parse(Fixture)!;
        root["program"]!["alternativeGroups"]![0]!["kind"] = kind;
        var view = await imports.CreateExternalImport(root.ToJsonString(), "program.json", default);
        var group = Assert.Single(view.Draft!.AlternativeGroups!);
        var selected = await imports.SelectAlternative(view.Id, group.Members[0].Id, default, group.Id);
        var day = selected.Draft!.Workouts[0];
        var edited = await imports.EditDays(view.Id, [day with { Notes = "Reviewed" }], selected.Revision, default);
        Assert.True(edited.Acceptable, Json.Write(edited.ReviewIssues));
        await Assert.ThrowsAsync<DomainException>(() => imports.Accept(view.Id, default, edited.Revision));
        var program = await imports.Accept(view.Id, default, edited.Revision, acknowledgeUncertainty: true);
        Assert.Equal("Strength", program.Name);
        Assert.Null(program.SourceImportId);
        var upper = Assert.Single(program.Workouts, workout => workout.Name == "Upper");
        Assert.Equal(("Base", "Build", 1, 1, "Reviewed"), (upper.Block, upper.Phase, upper.Week, upper.PhaseWeek, upper.Note));
        Assert.Contains(program.Workouts, workout => workout.IsRestDay && workout.Name == "Rest A");
        Assert.Equal(["Bench press", "Squat"], upper.Exercises.Select(exercise => exercise.SourceName));
        var bench = upper.Exercises[0];
        Assert.Equal(upper.Exercises[1].SequenceGroup, bench.SequenceGroup);
        Assert.Equal("Dumbbell press", Assert.Single(bench.Substitutions!));
        Assert.NotNull(bench.DemoUrl);
        Assert.Single(bench.DemoLinks!);
        var prescription = Assert.Single(bench.Sets);
        Assert.Equal((8, 10, 8.0, "2", 120, "3-0-1", "70%", "Slow"),
            (prescription.RepMin, prescription.RepMax, prescription.TargetRpe, prescription.Rir,
                prescription.RestSeconds, prescription.Tempo, prescription.LoadText, prescription.Notes));
        Assert.Contains("Dropset", Assert.Single(upper.Exercises[1].Sets).Notes);
        Assert.DoesNotContain("sourceReference", Json.Write(program), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("uncertainty", Json.Write(program), StringComparison.OrdinalIgnoreCase);
        var edit = ProgramEditRig.With(program, days => ProgramEditRig.Replace(days, upper.Id, day => day with
        {
            Exercises = day.Exercises.Select((exercise, index) => index == 0
                ? exercise with { Sets = exercise.Sets.Select(set => set with { TargetRpe = null }).ToList() }
                : exercise).ToList()
        }));
        h.Db.ChangeTracker.Clear();
        var updated = await h.ProgramEditor.UpdateProgram(program.Id, edit, default);
        Assert.Null(Assert.Single(updated.Workouts.First(day => day.Id == upper.Id).Exercises[0].Sets).TargetRpe);
    }
}
