using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

public sealed class BodyweightLoadGridTests
{
    [Theory]
    [InlineData(ResistanceModes.Added, 90, 83.3, 5, 88.3)]
    [InlineData(ResistanceModes.Assistance, 60, 86, 27.5, 58.5)]
    public void A_hard_hold_uses_the_conservative_physical_increment(
        string mode, double oldTotal, double bodyweight, double expectedInput, double expectedTotal)
    {
        var result = Suggest(mode, oldTotal, bodyweight);
        Assert.Equal(expectedInput, result.SuggestedLoadKg);
        Assert.Equal(expectedTotal, result.SuggestedSystemLoadKg);
        Assert.True(result.SuggestedSystemLoadKg <= oldTotal);
    }

    [Theory]
    [InlineData(ResistanceModes.Added, 90, 83, 5, 88)]
    [InlineData(ResistanceModes.Assistance, 60, 86, 40, 46)]
    public void A_changed_reference_never_invents_a_weight_between_list_entries(
        string mode, double oldTotal, double bodyweight, double expectedInput, double expectedTotal)
    {
        var result = Suggest(mode, oldTotal, bodyweight, [0, 5, 10, 25, 40]);
        Assert.Equal(expectedInput, result.SuggestedLoadKg);
        Assert.Equal(expectedTotal, result.SuggestedSystemLoadKg);
    }

    [Fact]
    public void Assistance_larger_than_bodyweight_keeps_the_actual_listed_input()
    {
        var result = Suggest(ResistanceModes.Assistance, 20, 80, [100, 120]);
        Assert.Equal(100, result.SuggestedLoadKg);
        Assert.Equal(0, result.SuggestedSystemLoadKg);
    }

    [Theory]
    [InlineData(ResistanceModes.Added)]
    [InlineData(ResistanceModes.Assistance)]
    public void First_exposure_does_not_prefill_a_load_even_with_a_weight_list(string mode)
    {
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8), [], ProgressionModes.Normal,
            2.5, null, mode, 80, [0, 10, 25]);
        Assert.Null(result.SuggestedLoadKg);
        Assert.Null(result.SuggestedSystemLoadKg);
    }

    [Theory]
    [InlineData(ResistanceModes.Added, 95, 83, 12.5, 95.5)]
    [InlineData(ResistanceModes.Assistance, 60, 86, 25, 61)]
    public void An_earned_increase_stays_on_the_current_physical_grid(
        string mode, double oldTotal, double bodyweight, double expectedInput, double expectedTotal)
    {
        var source = new SetExposure(Guid.NewGuid(), DateTime.UtcNow.AddDays(-1), 10, 12, 8,
            oldTotal, mode, RepMin: 8, RepMax: 12, TargetRpe: 8, HasPrescription: true);
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8), [source], ProgressionModes.Normal,
            2.5, null, mode, bodyweight);
        Assert.Equal(expectedInput, result.SuggestedLoadKg);
        Assert.Equal(expectedTotal, result.SuggestedSystemLoadKg);
        Assert.InRange(result.SuggestedReps, 8, 12);
    }

    [Fact]
    public void A_list_without_an_easier_weight_uses_a_real_weight_and_discloses_the_difference()
    {
        var result = Suggest(ResistanceModes.Added, 85, 83, [5, 10]);
        Assert.Equal(5, result.SuggestedLoadKg);
        Assert.Equal(88, result.SuggestedSystemLoadKg);
        Assert.Contains("total resistance differs", result.Reason);
    }

    [Fact]
    public void The_logged_load_limit_does_not_introduce_an_off_grid_input()
    {
        var result = Suggest(ResistanceModes.Added, 1100, 83, null, 3);
        Assert.Equal(999, result.SuggestedLoadKg);
        Assert.Equal(1082, result.SuggestedSystemLoadKg);
    }

    private static SetProgressionSuggestion Suggest(string mode, double oldTotal, double bodyweight,
        IReadOnlyList<double>? loads = null, double step = 2.5)
    {
        var source = new SetExposure(Guid.NewGuid(), DateTime.UtcNow.AddDays(-1), 10, 10, 9,
            oldTotal, mode, RepMin: 8, RepMax: 12, TargetRpe: 8, HasPrescription: true);
        return BodyweightProgression.Suggest(Harness.Set(8, 12, 8), [source], ProgressionModes.Normal,
            step, null, mode, bodyweight, loads);
    }
}
