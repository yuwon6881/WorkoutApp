using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportLoadBasisTests
{
    [Fact]
    public void Relative_backoffs_do_not_change_the_top_set_in_saved_prescriptions()
    {
        const string coaching = "Top set 80% 1RM, then back-offs use ~85% of your top set.";
        var plan = new SetPrescription(3, 3, null, null, null, "80%", null);
        var saved = ImportLoadBasis.ApplyPrescriptions([plan, plan with { LoadText = "85%" }], coaching);
        Assert.Null(saved[0].Notes);
        Assert.Contains("Percentage of top set", saved[1].Notes);
        var samePercent = ImportLoadBasis.ApplyPrescriptions([plan, plan], "Top set 80% 1RM, then use 80% of your top set.");
        Assert.Null(samePercent[0].Notes);
        Assert.Contains("Percentage of top set", samePercent[1].Notes);
    }

    [Fact]
    public void Prior_set_percentage_keeps_its_reference()
    {
        var set = new SetPrescription(10, 20, null, null, null, "60%", null);
        var result = ImportLoadBasis.ApplyPrescriptions([set], "Use ~60% of the weight you used on your top set.");
        Assert.Equal("60%", result.Single().LoadText);
        Assert.Contains("Percentage of top set", result.Single().Notes);
        var repeated = ImportLoadBasis.ApplyPrescriptions([set, set], "Use ~60% of the weight you used on your top set.");
        Assert.All(repeated, item => Assert.Contains("Percentage of top set", item.Notes));
    }

    [Fact]
    public void A_testing_opener_keeps_the_source_directive_on_the_first_working_set()
    {
        var set = new SetPrescription(1, 1, null, null, null, "100-105%", null);
        var result = ImportLoadBasis.ApplyPrescriptions([set with { Warmup = true }, set], "Start with 100% and increase on each attempt.");
        Assert.Null(result[0].Notes);
        Assert.Contains("Start with 100%", result[1].Notes);
    }
}
