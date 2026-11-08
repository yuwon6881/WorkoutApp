using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportLoadBasisTests
{
    [Fact]
    public void Relative_backoffs_do_not_change_the_top_set_in_draft_or_saved_prescriptions()
    {
        var top = new DraftSet(3, 3, null, null, null, "80%", null);
        var backoff = top with { LoadText = "85%" };
        const string coaching = "Top set 80% 1RM, then back-offs use ~85% of your top set.";
        var draft = ImportLoadBasis.Apply([top, backoff, backoff], coaching);
        Assert.Null(draft[0].Notes);
        Assert.All(draft.Skip(1), set => Assert.Contains("Percentage of top set", set.Notes));
        var plan = new Workout.Api.Domain.SetPrescription(3, 3, null, null, null, "80%", null);
        var saved = ImportLoadBasis.ApplyPrescriptions([plan, plan with { LoadText = "85%" }], coaching);
        Assert.Null(saved[0].Notes);
        Assert.Contains("Percentage of top set", saved[1].Notes);
        var samePercent = ImportLoadBasis.Apply([top, top], "Top set 80% 1RM, then use 80% of your top set.");
        Assert.Null(samePercent[0].Notes);
        Assert.Contains("Percentage of top set", samePercent[1].Notes);
    }
    [Fact]
    public async Task Imported_backoff_keeps_the_reference_in_its_draft()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench Press", "Chest", "Barbell", null, 2.5));
        var id = await h.ExerciseId("bench");
        var program = new AiProgram("Test", [new AiDay(null, null, 1, 1, "Day 1", false, null,
            [new AiExercise("Bench Press", id.ToString(), "Use ~60% of the weight you used on your top set.",
                [new AiSet(10, 20, null, null, null, "60%", null)])])]);
        var draft = await h.Imports(StubHandler.Program("{}")).ToDraft(program, default);
        var set = draft.Workouts.Single().Exercises.Single().Sets.Single();
        Assert.Equal("60%", set.LoadText);
        Assert.Contains("Percentage of top set", set.Notes);
    }
    [Fact]
    public void Prior_set_percentage_keeps_its_reference()
    {
        var set = new DraftSet(10, 20, null, null, null, "60%", null);
        var result = ImportLoadBasis.Apply([set], "Use ~60% of the weight you used on your top set.");
        Assert.Equal("60%", result.Single().LoadText);
        Assert.Contains("Percentage of top set", result.Single().Notes);
        var repeated = ImportLoadBasis.Apply([set, set], "Use ~60% of the weight you used on your top set.");
        Assert.All(repeated, item => Assert.Contains("Percentage of top set", item.Notes));
    }

    [Fact]
    public void A_testing_opener_keeps_the_source_directive_on_the_first_working_set()
    {
        var set = new DraftSet(1, 1, null, null, null, "100-105%", null);
        var result = ImportLoadBasis.Apply([set with { Warmup = true }, set], "Start with 100% and increase on each attempt.");
        Assert.Null(result[0].Notes);
        Assert.Contains("Start with 100%", result[1].Notes);
    }
}
