using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// An exercise edit that reaches several occurrences saves only the days it changed, so the
/// request stays the size of the edit rather than the size of the whole program.
public sealed class ImportEditDaysTests
{
    private static Dictionary<string, string?> Configured => new() { ["OpenAi:ApiKey"] = "test-key", ["OpenAi:Model"] = "gpt-5.4-mini" };

    private static ImportSourceInput Source() => new("block.pdf", 2, Enumerable.Range(1, 2)
        .Select(page => new ImportPageText(page, $"WEEK {page}\nBarbell bench press 3 x 8-10 @ RPE 8")).ToList());

    private const string ThreeWeeks = """
    {"programName":"Hypertrophy block","weeks":[
      {"week":1,"workouts":[{"name":"Day A","focus":"Push","notes":null,"exercises":[
        {"sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sets":[
          {"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"inferred","restSource":"extracted"}]}]}]},
      {"week":2,"workouts":[{"name":"Day A","focus":"Push","notes":null,"exercises":[
        {"sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sets":[
          {"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"inferred","restSource":"extracted"}]}]}]},
      {"week":3,"workouts":[{"name":"Day A","focus":"Push","notes":null,"exercises":[
        {"sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sets":[
          {"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"inferred","restSource":"extracted"}]}]}]}]}
    """;

    private static async Task<(Harness Harness, ImportService Imports, ImportView View)> Ready()
    {
        var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", null));
        var imports = h.Imports(StubHandler.Program(ThreeWeeks));
        var view = await imports.Create(Source(), default);
        Assert.Equal(ImportStatus.Ready, view.Status);
        Assert.Equal(3, view.Draft!.Workouts.Count);
        return (h, imports, view);
    }

    private static DraftWorkout WithRest(DraftWorkout day, int rest) => day with
    {
        Exercises = day.Exercises.Select(exercise => exercise with { RestSeconds = rest }).ToList()
    };

    [Fact]
    public async Task Acceptance_refuses_a_draft_revision_that_is_no_longer_current()
    {
        var (h, imports, view) = await Ready();
        await using var _ = h;
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Accept(view.Id, default, view.Revision - 1));
        Assert.Equal(409, failure.Status);
        Assert.Empty(await h.Programs.List(default));
        Assert.Equal(ImportStatus.Ready, (await imports.Get(view.Id, default)).Status);
    }

    [Fact] public async Task Changed_days_replace_their_lines_and_every_other_day_is_kept()
    {
        var (h, imports, view) = await Ready();
        await using var _ = h;
        var days = view.Draft!.Workouts;

        var saved = await imports.EditDays(view.Id, [WithRest(days[0], 90), WithRest(days[2], 90)], view.Revision, default);

        Assert.Equal(view.Revision + 1, saved.Revision);
        Assert.Equal<int?>([90, days[1].Exercises.Single().RestSeconds, 90], saved.Draft!.Workouts.Select(day => day.Exercises.Single().RestSeconds));
        Assert.Equal(days.Select(day => day.LineId), saved.Draft.Workouts.Select(day => day.LineId));
    }

    [Fact] public async Task A_stale_revision_or_unknown_day_changes_nothing()
    {
        var (h, imports, view) = await Ready();
        await using var _ = h;
        var days = view.Draft!.Workouts;

        var stale = await Assert.ThrowsAsync<DomainException>(() =>
            imports.EditDays(view.Id, [WithRest(days[0], 90)], view.Revision - 1, default));
        Assert.Equal(409, stale.Status);
        var unknown = await Assert.ThrowsAsync<DomainException>(() =>
            imports.EditDays(view.Id, [WithRest(days[0], 90), WithRest(days[1], 90) with { LineId = Guid.NewGuid() }], view.Revision, default));
        Assert.Equal(404, unknown.Status);
        var repeated = await Assert.ThrowsAsync<DomainException>(() =>
            imports.EditDays(view.Id, [WithRest(days[0], 90), WithRest(days[0], 60)], view.Revision, default));
        Assert.Equal(400, repeated.Status);

        var current = await imports.Get(view.Id, default);
        Assert.Equal(view.Revision, current.Revision);
        Assert.Equal(days.Select(day => day.Exercises.Single().RestSeconds), current.Draft!.Workouts.Select(day => day.Exercises.Single().RestSeconds));
    }
}
