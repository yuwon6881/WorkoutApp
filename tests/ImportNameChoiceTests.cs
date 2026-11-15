using Microsoft.EntityFrameworkCore;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Progression follows the library exercise, so a program that writes "High-Bar Squat" for the
/// lifter's usual "Squat" used to start a second history from nothing on every import. A link the
/// lifter changes in review is now remembered for that written name and reused by the next import.
public sealed class ImportNameChoiceTests
{
    private static string Program(params (string Block, string Name)[] rows)
    {
        var days = rows.Select((row, index) =>
            "{\"key\":\"d" + index + "\",\"week\":" + (index + 1) + ",\"name\":\"Legs\",\"phaseWeek\":1,\"block\":\"" + row.Block + "\",\"exercises\":["
            + "{\"sourceName\":\"" + row.Name + "\",\"sets\":[{\"repMin\":5,\"repMax\":5,\"targetRpe\":8,\"restSeconds\":180}]}]}");
        return "{\"version\":1,\"verified\":true,\"program\":{\"name\":\"Strength\",\"sourceWeekDays\":7,\"days\":["
            + string.Join(",", days) + "]}}";
    }

    private static string Program(string name) => Program(("Base", name));

    private static async Task<Harness> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("squat", "Squat", "Quads", "Barbell", null),
            new SeedExercise("high-bar-squat", "High-Bar Squat", "Quads", "Barbell", null));
        return h;
    }

    /// Imports the file, maps the first row's written name to the given exercise, and accepts it.
    private static async Task AcceptMapped(Harness h, string json, Guid? exerciseId)
    {
        var imports = h.Imports();
        var view = await imports.CreateExternalImport(json, "program.json", default);
        var row = view.Draft!.Workouts.First().Exercises.Single();
        if (exerciseId is not null) view = await imports.MapSlot(view.Id, row.LineId, exerciseId, view.Revision, default);
        await imports.Accept(view.Id, default, view.Revision, acknowledgeUncertainty: true);
    }

    private static async Task<(List<Guid?> Linked, List<ImportReviewIssue> Issues)> Import(Harness h, string json)
    {
        var view = await h.Imports().CreateExternalImport(json, "program.json", default);
        return ([.. view.Draft!.Workouts.SelectMany(day => day.Exercises).Select(exercise => exercise.ExerciseId)], view.ReviewIssues);
    }

    [Fact]
    public async Task A_link_changed_in_review_is_reused_by_the_next_import_and_announced()
    {
        await using var h = await Ready();
        var squat = await h.ExerciseId("squat");
        await AcceptMapped(h, Program("High-Bar Squat"), squat);

        var (linked, issues) = await Import(h, Program("high bar squat"));

        Assert.Equal([squat], linked);
        var notice = Assert.Single(issues, issue => issue.Code == "remembered_exercise_link");
        Assert.Equal("info", notice.Severity);
        Assert.StartsWith("high bar squat is linked the way you linked it", notice.Message);
    }

    [Fact]
    public async Task Linking_the_name_back_to_the_library_pick_forgets_the_choice()
    {
        await using var h = await Ready();
        var highBar = await h.ExerciseId("high-bar-squat");
        await AcceptMapped(h, Program("High-Bar Squat"), await h.ExerciseId("squat"));
        await AcceptMapped(h, Program("High-Bar Squat"), highBar);

        var (linked, issues) = await Import(h, Program("High-Bar Squat"));

        Assert.Equal([highBar], linked);
        Assert.DoesNotContain(issues, issue => issue.Code == "remembered_exercise_link");
        Assert.Empty(await h.Db.ExerciseNameChoices.ToListAsync());
    }

    [Fact]
    public async Task An_unmatched_name_mapped_in_review_is_linked_next_time()
    {
        await using var h = await Ready();
        var squat = await h.ExerciseId("squat");
        Assert.Equal([null], (await Import(h, Program("Comp Squat"))).Linked);
        await AcceptMapped(h, Program("Comp Squat"), squat);

        Assert.Equal([squat], (await Import(h, Program("Comp Squat"))).Linked);
    }

    [Fact]
    public async Task An_import_accepted_as_matched_remembers_nothing()
    {
        await using var h = await Ready();
        await AcceptMapped(h, Program("High-Bar Squat"), exerciseId: null);
        Assert.Empty(await h.Db.ExerciseNameChoices.ToListAsync());
    }

    [Fact]
    public async Task A_name_linked_two_ways_in_one_program_teaches_nothing()
    {
        await using var h = await Ready();
        var imports = h.Imports();
        var view = await imports.CreateExternalImport(Program(("Base", "High-Bar Squat"), ("Peak", "High-Bar Squat")), "program.json", default);
        var first = view.Draft!.Workouts.First().Exercises.Single();
        view = await imports.MapSlot(view.Id, first.LineId, await h.ExerciseId("squat"), view.Revision, default);
        Assert.Equal(2, view.Draft!.Workouts.SelectMany(day => day.Exercises).Select(exercise => exercise.ExerciseId).Distinct().Count());
        await imports.Accept(view.Id, default, view.Revision, acknowledgeUncertainty: true);

        Assert.Empty(await h.Db.ExerciseNameChoices.ToListAsync());
    }

    [Fact]
    public async Task A_choice_belongs_to_the_account_that_made_it()
    {
        await using var h = await Ready();
        await AcceptMapped(h, Program("High-Bar Squat"), await h.ExerciseId("squat"));
        await h.SignIn("bob");

        Assert.Equal([await h.ExerciseId("high-bar-squat")], (await Import(h, Program("High-Bar Squat"))).Linked);
    }
}
