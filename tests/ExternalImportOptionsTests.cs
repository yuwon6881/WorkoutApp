using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The assistant may offer a few answers for a detail it flagged; the review shows only answers it can apply.
public sealed class ExternalImportOptionsTests
{
    private static async Task<(Harness Harness, ImportService Imports)> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null),
            new SeedExercise("squat", "Squat", "Quads", "Barbell", null),
            new SeedExercise("row", "Barbell row", "Back", "Barbell", null));
        return (h, h.Imports());
    }

    private static string Exercise(string name, string uncertainty, string setUncertainty = "")
        => "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + $"{{\"sourceName\":\"{name}\",\"uncertainty\":{uncertainty},\"sets\":[{{\"repMin\":8,\"repMax\":10{setUncertainty}}}]}}]}}]}}}}";

    [Fact]
    public async Task Exercise_options_are_kept_only_when_the_library_holds_the_movement_and_get_its_id()
    {
        var (_, imports) = await Ready();
        var view = await imports.CreateExternalImport(Exercise("Mystery lift",
            "{\"flag\":true,\"reason\":\"Name cut off\",\"options\":["
            + "{\"label\":\"Bench\",\"exerciseName\":\"Bench press\",\"exerciseId\":\"" + Guid.NewGuid() + "\"},"
            + "{\"label\":\"Not in the library\",\"exerciseName\":\"Zercher snatch\"},"
            + "{\"label\":\"Row\",\"exerciseName\":\"Barbell row\"}]}"), "p.json", default);

        var exercise = view.Draft!.Workouts[0].Exercises[0];
        var options = exercise.Uncertainty!.Options!;
        Assert.Equal(["Bench", "Row"], options.Select(option => option.Label));
        Assert.Equal(await HarnessId("bench", imports), options[0].ExerciseId);
        Assert.NotEqual(options[0].ExerciseId, options[1].ExerciseId);
    }

    private static async Task<Guid?> HarnessId(string slug, ImportService imports)
    {
        var view = await imports.CreateExternalImport(
            "{\"version\":1,\"program\":{\"name\":\"Q\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + $"{{\"sourceName\":\"{(slug == "bench" ? "Bench press" : "Squat")}\",\"sets\":[{{\"repMin\":8,\"repMax\":10}}]}}]}}]}}}}", "q.json", default);
        return view.Draft!.Workouts[0].Exercises[0].ExerciseId;
    }

    [Fact]
    public async Task Choosing_an_option_maps_the_exercise_and_settles_its_flag_through_a_saved_edit()
    {
        var (_, imports) = await Ready();
        var view = await imports.CreateExternalImport(Exercise("Mystery lift",
            "{\"flag\":true,\"reason\":\"Name cut off\",\"options\":[{\"label\":\"Bench\",\"exerciseName\":\"Bench press\"}]}"), "p.json", default);
        Assert.Contains(view.ReviewIssues!, issue => issue.Code == "external_uncertainty");
        Assert.Single(view.Unresolved);

        var day = view.Draft!.Workouts[0];
        var chosen = day.Exercises[0].Uncertainty!.Options![0];
        var edited = day with { Exercises = [day.Exercises[0] with { ExerciseId = chosen.ExerciseId, Uncertainty = new ImportUncertainty(false, "Name cut off") }] };
        var saved = await imports.EditDays(view.Id, [edited], view.Revision, default);

        Assert.DoesNotContain(saved.ReviewIssues!, issue => issue.Code == "external_uncertainty");
        Assert.Empty(saved.Unresolved);
        Assert.Equal(chosen.ExerciseId, saved.Draft!.Workouts[0].Exercises[0].ExerciseId);
    }

    [Fact]
    public async Task An_option_for_the_movement_already_chosen_is_not_offered_and_all_dropped_options_leave_the_flag()
    {
        var (_, imports) = await Ready();
        var view = await imports.CreateExternalImport(Exercise("Bench press",
            "{\"flag\":true,\"reason\":\"Check\",\"options\":[{\"label\":\"Same\",\"exerciseName\":\"Bench press\"}]}"), "p.json", default);

        var uncertainty = view.Draft!.Workouts[0].Exercises[0].Uncertainty!;
        Assert.True(uncertainty.Flag);
        Assert.Null(uncertainty.Options);
    }

    [Fact]
    public async Task Set_options_keep_their_reps_and_effort_and_an_unflagged_detail_keeps_none()
    {
        var (_, imports) = await Ready();
        var view = await imports.CreateExternalImport(Exercise("Bench press", "{\"flag\":false}",
            ",\"uncertainty\":{\"flag\":true,\"reason\":\"Printed 15 against a 21 total\",\"options\":["
            + "{\"label\":\"21 reps\",\"repMin\":21,\"repMax\":21},{\"label\":\"RPE 9\",\"targetRpe\":9},{\"label\":\"Again 21\",\"repMin\":21,\"repMax\":21}]}"),
            "p.json", default);

        var exercise = view.Draft!.Workouts[0].Exercises[0];
        Assert.Null(exercise.Uncertainty!.Options);
        var options = exercise.Sets[0].Uncertainty!.Options!;
        Assert.Equal(2, options.Count);
        Assert.Equal((21, 21), (options[0].RepMin, options[0].RepMax));
        Assert.Equal(9, options[1].TargetRpe);
    }

    [Theory]
    [InlineData("exercise", "{\"flag\":true,\"options\":[{\"label\":\"a\",\"exerciseName\":\"Squat\"},{\"label\":\"b\",\"exerciseName\":\"Squat\"},{\"label\":\"c\",\"exerciseName\":\"Squat\"},{\"label\":\"d\",\"exerciseName\":\"Squat\"},{\"label\":\"e\",\"exerciseName\":\"Squat\"}]}")]
    [InlineData("exercise", "{\"flag\":true,\"options\":[{\"label\":\"a\",\"repMin\":5,\"repMax\":5}]}")]
    [InlineData("exercise", "{\"flag\":true,\"options\":[{\"label\":\"a\"}]}")]
    [InlineData("set", "{\"flag\":true,\"options\":[{\"label\":\"a\",\"exerciseName\":\"Squat\"}]}")]
    [InlineData("set", "{\"flag\":true,\"options\":[{\"label\":\"a\",\"repMin\":5}]}")]
    [InlineData("set", "{\"flag\":true,\"options\":[{\"label\":\"a\",\"targetRpe\":8.25}]}")]
    [InlineData("set", "{\"flag\":true,\"options\":[{\"label\":\"a\"}]}")]
    public async Task An_option_of_the_wrong_shape_is_reported_at_the_detail_it_belongs_to(string owner, string uncertainty)
    {
        var (_, imports) = await Ready();
        var file = owner == "exercise" ? Exercise("Bench press", uncertainty) : Exercise("Bench press", "{\"flag\":false}", ",\"uncertainty\":" + uncertainty);

        var error = await Assert.ThrowsAsync<DomainException>(() => imports.CreateExternalImport(file, "p.json", default));

        Assert.Contains(ExternalImportPath.ErrorsOf(error), item => item.Path.Contains(".uncertainty"));
    }

    [Fact]
    public async Task Options_on_a_program_choice_are_refused()
    {
        var (_, imports) = await Ready();
        const string file = """
        {"version":1,"program":{"name":"P","days":[
          {"key":"a","week":1,"name":"A","exercises":[{"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10}]}]},
          {"key":"b","week":1,"name":"B","exercises":[{"sourceName":"Squat","sets":[{"repMin":8,"repMax":10}]}]}],
         "alternativeGroups":[{"id":"g","kind":"program","members":[
           {"id":"x","name":"X","dayKeys":["a"],"uncertainty":{"flag":true,"options":[{"label":"a","exerciseName":"Squat"}]}},
           {"id":"y","name":"Y","dayKeys":["b"]}]}]}}
        """;

        await Assert.ThrowsAsync<DomainException>(() => imports.CreateExternalImport(file, "p.json", default));
    }
}
