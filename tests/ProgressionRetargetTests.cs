using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

/// A set logged harder than its target effort is re-aimed from its reps to failure (reps + reserve,
/// the Epley/RIR estimate the rest of the policy uses): fewer reps at the same load while that still
/// reaches the prescription, otherwise a lighter load for its minimum.
public sealed class ProgressionRetargetTests
{
    private static SetExposure Exposure(double load, int? reps, double? rpe, int daysAgo = 0)
        => new(Guid.NewGuid(), DateTime.UtcNow.AddDays(-daysAgo), load, reps, rpe);

    [Fact]
    public void A_failure_set_inside_the_range_aims_for_fewer_reps_at_the_same_load()
    {
        // 11 reps at 0 RIR leaves 11 reps to failure; at the 2 RIR target that is 9.
        var result = Progression.SuggestSet(8, 12, 8, [Exposure(50, 11, 10)], ProgressionModes.Normal, 2.5);

        Assert.Equal(50, result.SuggestedLoadKg);
        Assert.Equal(9, result.SuggestedReps);
        Assert.Contains("harder than the target", result.Reason);
    }

    [Fact]
    public void A_failure_set_that_cannot_reach_the_range_at_target_effort_gets_a_lighter_load()
    {
        // 7 to failure at 50 kg: 8 reps at 2 RIR needs about 50 × 37 / 40 = 46.25 kg, so 45 kg.
        var result = Progression.SuggestSet(8, 12, 8, [Exposure(50, 7, 10)], ProgressionModes.Normal, 2.5);

        Assert.Equal(45, result.SuggestedLoadKg);
        Assert.Equal(8, result.SuggestedReps);
        Assert.Contains("lighter", result.Reason);
    }

    [Fact]
    public void An_exact_rep_target_done_too_hard_lowers_the_load_instead_of_the_reps()
    {
        // 8 reps at failure on an 8-rep, 2 RIR set: 60 × 38 / 40 = 57 kg, so 55 kg for 8.
        var result = Progression.SuggestSet(8, 8, 8, [Exposure(60, 8, 10)], ProgressionModes.Normal, 2.5);

        Assert.Equal(55, result.SuggestedLoadKg);
        Assert.Equal(8, result.SuggestedReps);
    }

    [Fact]
    public void A_half_rep_overshoot_trims_one_rep_rather_than_repeating()
    {
        var result = Progression.SuggestSet(8, 12, 8, [Exposure(50, 10, 8.5)], ProgressionModes.Normal, 2.5);

        Assert.Equal(50, result.SuggestedLoadKg);
        Assert.Equal(9, result.SuggestedReps);
    }

    [Fact]
    public void An_available_weight_list_drops_to_a_real_lighter_weight()
    {
        var loads = new LoadOptions(2.5, AvailableLoadsKg: [40, 44, 48, 52]);
        var result = Progression.Suggest(new SetPrescription(8, 12, 8, null, null, null, null),
            [Exposure(52, 6, 10)], ProgressionModes.Normal, loads);

        // 52 × 36 / 40 = 46.8 kg: the heaviest listed weight at or below it.
        Assert.Equal(44, result.SuggestedLoadKg);
        Assert.Equal(8, result.SuggestedReps);
    }

    [Fact]
    public void Without_a_lighter_weight_the_reps_are_aimed_at_what_is_achievable()
    {
        var loads = new LoadOptions(2.5, AvailableLoadsKg: [20]);
        var result = Progression.Suggest(new SetPrescription(8, 12, 8, null, null, null, null),
            [Exposure(20, 6, 10)], ProgressionModes.Normal, loads);

        Assert.Equal(20, result.SuggestedLoadKg);
        Assert.Equal(4, result.SuggestedReps);
    }

    [Fact]
    public void An_easier_rir_target_this_week_trims_reps_from_last_weeks_harder_set()
    {
        // Last week: 10 reps at 1 RIR against a RIR 1 target. This week asks for 3 in reserve.
        var source = new SetExposure(Guid.NewGuid(), DateTime.UtcNow.AddDays(-7), 50, 10, 9, Rir: "1",
            RepMin: 8, RepMax: 12, TargetRir: "1", HasPrescription: true);
        var result = Progression.Suggest(new SetPrescription(8, 12, null, null, null, null, null) { Rir = "3" },
            [source], ProgressionModes.Normal, new LoadOptions(2.5));

        Assert.Equal(50, result.SuggestedLoadKg);
        Assert.Equal(8, result.SuggestedReps);
    }

    [Fact]
    public void Repeatedly_missing_the_minimum_with_unknown_effort_steps_the_load_down()
    {
        var once = Progression.SuggestSet(8, 12, 8, [Exposure(50, 5, null)], ProgressionModes.Normal, 2.5);
        var twice = Progression.SuggestSet(8, 12, 8, [Exposure(50, 5, null), Exposure(50, 5, null, 7)], ProgressionModes.Normal, 2.5);

        Assert.Equal(50, once.SuggestedLoadKg);
        Assert.Equal(47.5, twice.SuggestedLoadKg);
        Assert.Equal(8, twice.SuggestedReps);
    }

    [Fact]
    public void A_set_on_target_effort_is_not_retargeted()
    {
        var result = Progression.SuggestSet(8, 12, 8, [Exposure(50, 10, 8)], ProgressionModes.Normal, 2.5);

        Assert.Equal(50, result.SuggestedLoadKg);
        Assert.Equal(11, result.SuggestedReps);
    }
}
