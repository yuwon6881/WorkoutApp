using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

public sealed class BodyweightProgressionTests
{
    [Fact]
    public void Alternating_heavy_and_light_days_keep_their_own_bodyweight_load_evidence()
    {
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8),
            [Exposure(80, 12, 1), Exposure(60, 20, 4) with { RepMin = 15, RepMax = 20 }, Exposure(80, 12, 8)],
            ProgressionModes.Conservative, 2.5, null, ResistanceModes.Added, 80);
        Assert.Equal(2.5, result.SuggestedLoadKg);
        Assert.Equal(82.5, result.SuggestedSystemLoadKg);
        Assert.False(result.IsBodyweightAdjustment);
    }

    [Fact]
    public void Hard_exposures_at_different_bodyweight_resistances_never_combine_into_a_deload()
    {
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8),
            [Exposure(80, 8, 1) with { Rpe = 9 }, Exposure(75, 8, 8) with { Rpe = 9 }],
            ProgressionModes.Normal, 2.5, null, ResistanceModes.Assistance, 80);
        Assert.Equal(0, result.SuggestedLoadKg);
        Assert.Equal(80, result.SuggestedSystemLoadKg);
        Assert.Contains("hard exposure", result.Reason);
    }

    [Fact]
    public void A_missing_historical_snapshot_does_not_borrow_a_later_or_older_weight()
    {
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8),
            [Exposure(80, 12, 1) with { SystemLoadKg = null }, Exposure(80, 12, 8)],
            ProgressionModes.Normal, 2.5, null, ResistanceModes.Added, 80);
        Assert.Null(result.SuggestedLoadKg);
        Assert.Null(result.SuggestedSystemLoadKg);
    }

    [Fact]
    public void Available_assistance_weights_still_determine_the_suggested_input()
    {
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8), [Exposure(60, 10, 1)],
            ProgressionModes.Normal, 2.5, null, ResistanceModes.Assistance, 85, [0, 10, 25, 40]);
        Assert.Equal(25, result.SuggestedLoadKg);
        Assert.Equal(60, result.SuggestedSystemLoadKg);
    }

    private static SetExposure Exposure(double load, int reps, int daysAgo) => new(Guid.NewGuid(),
        DateTime.UtcNow.AddDays(-daysAgo), 0, reps, 8, load, ResistanceModes.Added,
        RepMin: 8, RepMax: 12, TargetRpe: 8, HasPrescription: true);

    [Fact]
    public void Missing_current_weight_holds_reps_without_claiming_a_progression_at_unknown_resistance()
    {
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8), [Exposure(80, 10, 1)],
            ProgressionModes.Normal, 2.5, null, ResistanceModes.Added, null);
        Assert.Equal(10, result.SuggestedReps);
        Assert.Null(result.SuggestedSystemLoadKg);
        Assert.Null(result.SuggestedLoadKg);
    }
}
