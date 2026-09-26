using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class AdaptiveProgressionTests
{
    private static SetExposure Exposure(double load, int reps, double? rpe, int daysAgo = 0)
        => new(Guid.NewGuid(), DateTime.UtcNow.AddDays(-daysAgo), load, reps, rpe);

    [Fact]
    public void A_first_exposure_keeps_load_unknown_and_starts_at_the_minimum()
    {
        var result = Progression.SuggestSet(8, 12, 8, [], ProgressionModes.Normal, 2.5, 17);

        Assert.Null(result.SuggestedLoadKg);
        Assert.Equal(8, result.SuggestedReps);
        Assert.Equal(17, result.NutritionContextRevision);
    }

    [Fact]
    public void A_success_below_the_top_adds_one_rep_at_the_same_load()
    {
        var result = Progression.SuggestSet(8, 12, 8, [Exposure(40, 10, 8)], ProgressionModes.Normal, 2.5);

        Assert.Equal(40, result.SuggestedLoadKg);
        Assert.Equal(11, result.SuggestedReps);
    }

    [Fact]
    public void A_modest_step_can_aim_one_rep_above_the_estimate_within_a_narrow_range()
    {
        var result = Progression.SuggestSet(6, 8, 8, [Exposure(40, 8, 8)], ProgressionModes.Normal, 2.5);

        Assert.Equal(6, result.SuggestedReps);
        Assert.False(result.IsRepRangeTransition);
        Assert.Equal(42.5, result.SuggestedLoadKg);
    }

    [Theory]
    [InlineData(ProgressionModes.Normal, 1)]
    [InlineData(ProgressionModes.Conservative, 2)]
    [InlineData(ProgressionModes.Preservation, 3)]
    public void A_top_of_range_load_increase_uses_the_mode_threshold(string mode, int required)
    {
        var history = Enumerable.Range(0, required)
            .Select(daysAgo => Exposure(40, 12, 8, daysAgo)).ToList();

        var result = Progression.SuggestSet(8, 12, 8, history, mode, 2.5);

        Assert.Equal(42.5, result.SuggestedLoadKg);
        Assert.Equal(9, result.SuggestedReps);
        Assert.Contains($"{required} qualified", result.Reason);
    }

    [Fact]
    public void Missing_rpe_repeats_the_last_reps_without_advancing_a_streak()
    {
        var result = Progression.SuggestSet(8, 12, 8,
            [Exposure(40, 12, null), Exposure(40, 12, 8)], ProgressionModes.Normal, 2.5);

        Assert.Equal(40, result.SuggestedLoadKg);
        Assert.Equal(12, result.SuggestedReps);
        Assert.Contains("No actual RPE", result.Reason);
    }

    [Fact]
    public void Neutral_effort_repeats_and_resets_a_qualified_streak()
    {
        var result = Progression.SuggestSet(8, 12, 8,
            [Exposure(40, 12, 8.5), Exposure(40, 12, 8)], ProgressionModes.Normal, 2.5);

        Assert.Equal(40, result.SuggestedLoadKg);
        Assert.Equal(12, result.SuggestedReps);
        Assert.Contains("not within", result.Reason);
    }

    [Fact]
    public void Hard_exposures_repeat_then_reduce_then_deload()
    {
        var first = Progression.SuggestSet(8, 12, 8, [Exposure(40, 7, 9)], ProgressionModes.Normal, 2.5);
        var second = Progression.SuggestSet(8, 12, 8, [Exposure(40, 7, 9), Exposure(40, 7, 9, 7)], ProgressionModes.Normal, 2.5);
        var third = Progression.SuggestSet(8, 12, 8,
            [Exposure(40, 7, 9), Exposure(40, 7, 9, 7), Exposure(40, 7, 9, 14), Exposure(40, 12, 8, 21)], ProgressionModes.Normal, 2.5);

        Assert.Equal(40, first.SuggestedLoadKg);
        Assert.Equal(37.5, second.SuggestedLoadKg);
        Assert.Equal(35, third.SuggestedLoadKg);
        Assert.True(third.Reason.Contains("Deload", StringComparison.Ordinal));
    }

    [Fact]
    public void Reps_only_movements_do_not_invent_a_load_progression()
    {
        var result = Progression.SuggestSet(10, 20, 8, [Exposure(0, 20, 8)], ProgressionModes.Normal, 2.5,
            resistanceMode: ResistanceModes.RepsOnly);

        Assert.Null(result.SuggestedLoadKg);
        Assert.Equal(20, result.SuggestedReps);
    }

    [Fact]
    public void A_bodyweight_history_without_a_snapshot_cannot_be_used_as_system_load()
    {
        var result = Progression.SuggestSet(8, 12, 8,
            [Exposure(20, 12, 8)], ProgressionModes.Normal, 2.5,
            resistanceMode: ResistanceModes.Added, suggestedLoad: exposure => exposure.SystemLoadKg);

        Assert.Null(result.SuggestedLoadKg);
        Assert.Equal(8, result.SuggestedReps);
    }

    [Fact]
    public void Missing_or_neutral_effort_never_leaves_the_prescription_range()
    {
        var missing = Progression.SuggestSet(8, 10, 8, [Exposure(40, 15, null)], ProgressionModes.Normal, 2.5);
        var neutral = Progression.SuggestSet(8, 10, 8, [Exposure(40, 2, 8.5)], ProgressionModes.Normal, 2.5);
        Assert.InRange(missing.SuggestedReps, 8, 10);
        Assert.InRange(neutral.SuggestedReps, 8, 10);
    }

    [Fact]
    public void An_older_heavier_success_never_increases_the_deload_weight()
    {
        var result = Progression.SuggestSet(8, 12, 8,
            [Exposure(42.5, 7, 9), Exposure(42.5, 7, 9, 7), Exposure(42.5, 7, 9, 14), Exposure(50, 12, 8, 21)],
            ProgressionModes.Normal, 2.5);
        Assert.Equal(37.5, result.SuggestedLoadKg);
    }

    [Fact]
    public void Fourth_hard_exposure_deloads_from_the_current_failed_weight()
    {
        var result = Progression.SuggestSet(8, 12, 8,
            [
                Exposure(37.5, 7, 9),
                Exposure(37.5, 7, 9, 7),
                Exposure(42.5, 7, 9, 14),
                Exposure(42.5, 7, 9, 21),
                Exposure(50, 12, 8, 28)
            ],
            ProgressionModes.Normal, 2.5);

        Assert.Equal(32.5, result.SuggestedLoadKg);
        Assert.Contains("Reducing another 7.5%", result.Reason);
    }

    [Fact]
    public void Nutrition_mode_uses_the_boundary_and_requires_a_qualified_observed_window()
    {
        var now = DateTime.UtcNow;
        NutritionTrainingContext Context(double? target, double? observed, int? window, DateTime retrieved)
            => new("subject", 4, "UTC", "lose", false, target, observed, window, 80, null, 79, null, retrieved, true);

        Assert.Equal(ProgressionModes.Conservative, NutritionContextService.Mode(Context(.749, null, null, now), now));
        Assert.Equal(ProgressionModes.Preservation, NutritionContextService.Mode(Context(.75, null, null, now), now));
        Assert.Equal(ProgressionModes.Preservation, NutritionContextService.Mode(Context(null, .75, 14, now), now));
        Assert.Equal(ProgressionModes.Normal, NutritionContextService.Mode(Context(null, .75, 7, now), now));
        Assert.Equal(ProgressionModes.Normal, NutritionContextService.Mode(new NutritionTrainingContext("subject", 4, "UTC", "lose", true, .5, null, null, 80, null, 79, null, now, true), now));
        Assert.Equal(ProgressionModes.Conservative, NutritionContextService.Mode(Context(.5, null, null, now.AddDays(-6).AddHours(-23)), now));
        Assert.Equal(ProgressionModes.Normal, NutritionContextService.Mode(Context(.5, null, null, now.AddDays(-8)), now));
    }
}
