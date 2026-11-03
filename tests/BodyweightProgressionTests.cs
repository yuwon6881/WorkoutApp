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
        // One hard exposure, not a deload: 8 reps at RPE 9 against a 2 RIR target needs a little help.
        Assert.Equal(2.5, result.SuggestedLoadKg);
        Assert.Equal(77.5, result.SuggestedSystemLoadKg);
        Assert.DoesNotContain("Deload", result.Reason);
    }

    [Fact]
    public void A_missing_historical_snapshot_does_not_borrow_a_later_or_older_weight()
    {
        var newest = Exposure(80, 12, 1) with { SystemLoadKg = null, LoadKg = 10 };
        var older = Exposure(85, 12, 8) with { LoadKg = 5 };
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8), [newest, older],
            ProgressionModes.Normal, 2.5, null, ResistanceModes.Added, 80);
        // The added weight is repeated as logged and totalled with today's weight alone; the older
        // session's total is never used to claim a step from a session that has none.
        Assert.Equal(10, result.SuggestedLoadKg);
        Assert.Equal(90, result.SuggestedSystemLoadKg);
        Assert.Equal(12, result.SuggestedReps);
        Assert.Contains("Add weight when", result.Reason);
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
    public void Missing_current_weight_builds_reps_at_the_entered_weight_without_claiming_a_total()
    {
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8), [Exposure(80, 10, 1) with { LoadKg = 5 }],
            ProgressionModes.Normal, 2.5, null, ResistanceModes.Added, null);
        Assert.Equal(11, result.SuggestedReps);
        Assert.Equal(5, result.SuggestedLoadKg);
        Assert.Null(result.SuggestedSystemLoadKg);
        Assert.Contains("total resistance can't be estimated", result.Reason);
    }

    [Theory]
    [InlineData(ResistanceModes.Bodyweight)]
    [InlineData(ResistanceModes.Assistance)]
    public void Without_a_weigh_in_reps_still_progress_and_nothing_counts_as_a_first_session(string mode)
    {
        var history = new[] { 9, 8 }.Select((reps, index) => Exposure(80, reps, 3 + 3 * index) with
        {
            ResistanceMode = mode, SystemLoadKg = null, LoadKg = mode == ResistanceModes.Bodyweight ? null : 20
        }).ToList();
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8), history,
            ProgressionModes.Normal, 2.5, null, mode, null);
        Assert.Equal(10, result.SuggestedReps);
        Assert.NotNull(result.SourceSessionId);
        Assert.Equal(mode == ResistanceModes.Bodyweight ? null : (double?)20, result.SuggestedLoadKg);
        Assert.Null(result.SuggestedSystemLoadKg);
    }

    private static SetExposure Plain(int reps, int daysAgo, double rpe = 8) => new(Guid.NewGuid(),
        DateTime.UtcNow.AddDays(-daysAgo), null, reps, rpe, 80, ResistanceModes.Bodyweight,
        RepMin: 8, RepMax: 12, TargetRpe: 8, HasPrescription: true);

    // Trend weight moves a little nearly every day. A change worth less than a whole rep at the
    // set's effort must not replace the policy's progression with a re-estimate of the last reps.
    [Theory]
    [InlineData(80.0)]
    [InlineData(79.9)]
    [InlineData(80.1)]
    [InlineData(79.0)]
    [InlineData(81.0)]
    public void A_small_bodyweight_change_keeps_plain_bodyweight_reps_progressing(double today)
    {
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8), [Plain(9, 3), Plain(8, 6)],
            ProgressionModes.Normal, 0, null, ResistanceModes.Bodyweight, today);
        Assert.Equal(10, result.SuggestedReps);
        Assert.Equal(today, result.SuggestedSystemLoadKg);
        Assert.False(result.IsBodyweightAdjustment);
        Assert.Contains("one more rep", result.Reason);
    }

    // A real change moves the progressed target, not the last session's reps: lighter adds only the
    // whole reps it earns, heavier takes away at least what it costs.
    [Theory]
    [InlineData(76, 12)]
    [InlineData(78, 11)]
    [InlineData(83, 8)]
    [InlineData(84, 8)]
    public void A_real_bodyweight_change_adjusts_the_progressed_reps(double today, int expected)
    {
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8), [Plain(9, 3), Plain(8, 6)],
            ProgressionModes.Normal, 0, null, ResistanceModes.Bodyweight, today);
        Assert.Equal(expected, result.SuggestedReps);
        Assert.True(result.IsBodyweightAdjustment);
        Assert.Contains("bodyweight changed", result.Reason);
    }

    [Fact]
    public void A_small_bodyweight_change_keeps_the_hard_exposure_rule()
    {
        var result = BodyweightProgression.Suggest(Harness.Set(8, 12, 8), [Plain(10, 3, 10)],
            ProgressionModes.Normal, 0, null, ResistanceModes.Bodyweight, 79.8);
        Assert.Equal(8, result.SuggestedReps);
        Assert.Contains("harder than the target", result.Reason);
    }
}
