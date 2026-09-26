using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

public sealed class PrescriptionProgressionTests
{
    private static SetExposure Exposure(double load, int reps, double? rpe, string? rir = null)
        => new(Guid.NewGuid(), DateTime.UtcNow, load, reps, rpe, Rir: rir);

    [Fact]
    public void Repeated_one_rep_short_at_target_effort_keeps_building_without_deload()
    {
        var history = Enumerable.Range(0, 3).Select(_ => Exposure(50, 7, 8)).ToList();
        var result = Progression.SuggestSet(8, 8, 8, history, "normal", 2.5);
        Assert.Equal(50, result.SuggestedLoadKg);
        Assert.Equal(8, result.SuggestedReps);
        Assert.DoesNotContain("hard", result.Reason);
    }

    [Fact]
    public void Top_of_wide_range_chooses_reps_supported_by_the_next_load()
    {
        var result = Progression.SuggestSet(10, 15, 8, [Exposure(50, 15, 8)], "normal", 2.5);
        Assert.Equal(52.5, result.SuggestedLoadKg);
        Assert.Equal(12, result.SuggestedReps);
    }

    [Fact]
    public void Large_step_can_temporarily_go_below_range_and_then_rebuild()
    {
        var result = Progression.SuggestSet(10, 15, 8, [Exposure(12.5, 15, 8)], "normal", 2.5);
        Assert.Equal(15, result.SuggestedLoadKg);
        Assert.Equal(7, result.SuggestedReps);
        Assert.True(result.IsRepRangeTransition);
        var next = Progression.SuggestSet(10, 15, 8,
            [Exposure(15, 7, 8) with { IsRepRangeTransition = true }], "normal", 2.5);
        Assert.Equal(15, next.SuggestedLoadKg);
        Assert.Equal(8, next.SuggestedReps);
        Assert.True(next.IsRepRangeTransition);
    }

    [Fact]
    public void An_excessive_step_is_held_instead_of_inventing_achievable_reps()
    {
        var result = Progression.SuggestSet(10, 15, 8, [Exposure(5, 15, 8)], "normal", 2.5);
        Assert.Equal(5, result.SuggestedLoadKg);
        Assert.Equal(15, result.SuggestedReps);
    }

    [Fact]
    public void Unspecified_effort_does_not_treat_failure_as_missing_a_hidden_RIR2_target()
    {
        var result = Progression.SuggestSet(10, 15, null, [Exposure(50, 15, 10)], "normal", 2.5);
        Assert.Equal(52.5, result.SuggestedLoadKg);
        Assert.InRange(result.SuggestedReps, 10, 15);
    }

    [Fact]
    public void Five_plus_RIR_is_known_easy_effort()
    {
        var result = Progression.SuggestSet(10, 15, 8, [Exposure(50, 15, null, "5+")], "normal", 2.5);
        Assert.Equal(52.5, result.SuggestedLoadKg);
        Assert.DoesNotContain("No actual", result.Reason);
    }

    [Fact]
    public void No_rep_target_keeps_load_without_an_invented_one_rep_ceiling()
    {
        var prescription = new SetPrescription(null, null, 8, null, null, null, null);
        var result = Progression.Suggest(prescription, [Exposure(50, 8, 8)], "normal", new LoadOptions(2.5));
        Assert.Equal(50, result.SuggestedLoadKg);
        Assert.Null(Progression.PrefillReps(prescription, result));
    }

    [Theory]
    [InlineData(1.25, 51.25)]
    [InlineData(2.5, 52.5)]
    [InlineData(5, 55)]
    public void Resolved_exercise_increment_is_an_input_to_the_policy(double step, double expected)
    {
        var prescription = new SetPrescription(10, 15, 8, null, null, null, null);
        var result = Progression.Suggest(prescription, [Exposure(50, 15, 8)], "normal", new LoadOptions(step));
        Assert.Equal(expected, result.SuggestedLoadKg);
    }

    [Fact]
    public void A_changed_prescription_reselects_load_instead_of_doubling_reps_at_the_old_weight()
    {
        var history = Exposure(50, 5, 8) with { RepMin = 5, RepMax = 5, TargetRpe = 8, HasPrescription = true };
        var result = Progression.SuggestSet(10, 15, 8, [history], "normal", 2.5);
        Assert.True(result.SuggestedLoadKg < 50);
        Assert.InRange(result.SuggestedReps, 10, 15);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(8.0)]
    public void Repeated_top_results_with_unknown_actual_effort_can_progress_cautiously(double? goal)
    {
        var result = Progression.SuggestSet(10, 15, goal,
            [Exposure(50, 15, null), Exposure(50, 15, null)], "normal", 2.5);
        Assert.Equal(52.5, result.SuggestedLoadKg);
        Assert.InRange(result.SuggestedReps, 10, 15);
        Assert.False(result.IsRepRangeTransition);
    }

    [Theory]
    [InlineData(8.0, 8.0, 2)]
    [InlineData(null, 8.0, 2)]
    [InlineData(null, null, 3)]
    public void Open_reps_progress_from_repeated_improvement_without_prefilling_reps(double? target, double? actual, int count)
    {
        var prescription = new SetPrescription(null, null, target, null, null, null, null);
        var history = Enumerable.Range(0, count).Select(index => Exposure(50, 12 - index, actual)).ToList();
        var result = Progression.Suggest(prescription, history, "normal", new LoadOptions(2.5));
        Assert.Equal(52.5, result.SuggestedLoadKg);
        Assert.Null(Progression.PrefillReps(prescription, result));
    }

    [Fact]
    public void A_new_effort_target_reselects_load_and_does_not_count_as_a_failed_session()
    {
        var prescription = new SetPrescription(8, 8, 6, null, null, null, null, Rir: "5+");
        var source = Exposure(50, 8, 10) with { RepMin = 8, RepMax = 8, TargetRpe = 10, HasPrescription = true };
        var result = Progression.Suggest(prescription, [source, source], "normal", new LoadOptions(2.5));
        Assert.Equal(42.5, result.SuggestedLoadKg);
        Assert.Equal(8, result.SuggestedReps);
        Assert.Contains("Prescription changed", result.Reason);
    }

    [Fact]
    public void High_reps_do_not_extrapolate_a_load_increase()
    {
        var result = Progression.SuggestSet(20, 40, 8, [Exposure(10, 40, 8)], "normal", 2.5);
        Assert.Equal(10, result.SuggestedLoadKg);
        Assert.Equal(40, result.SuggestedReps);
    }

    [Fact]
    public void A_grid_offset_and_a_non_grid_current_load_use_the_next_available_weight()
    {
        var prescription = new SetPrescription(10, 15, 8, null, null, null, null);
        var result = Progression.Suggest(prescription, [Exposure(51, 15, 8)], "normal", new LoadOptions(2.5, 1));
        Assert.Equal(53.5, result.SuggestedLoadKg);
        Assert.Equal(53.5, new LoadOptions(2.5, 1).Next(52));
    }

    [Fact]
    public void Assisted_system_load_is_bounded_by_bodyweight()
    {
        var prescription = new SetPrescription(10, 15, 8, null, null, null, null);
        var source = Exposure(10, 15, 8) with { SystemLoadKg = 70, ResistanceMode = ResistanceModes.Assistance };
        var result = Progression.Suggest(prescription, [source], "normal", new LoadOptions(2.5, 80, 0, 80),
            resistanceMode: ResistanceModes.Assistance, selectLoad: exposure => exposure.SystemLoadKg);
        Assert.Equal(72.5, result.SuggestedLoadKg);
        Assert.Equal(72.5, result.SuggestedSystemLoadKg);
    }

    [Fact]
    public void Missing_actual_effort_can_build_reps_after_repeated_results()
    {
        var result = Progression.SuggestSet(10, 15, null,
            [Exposure(50, 11, null), Exposure(50, 11, null)], "normal", 2.5);
        Assert.Equal(50, result.SuggestedLoadKg);
        Assert.Equal(12, result.SuggestedReps);
        Assert.Contains("unknown", result.Reason);
    }

    [Fact]
    public void Missing_actual_effort_during_transition_does_not_jump_back_to_the_minimum()
    {
        var result = Progression.SuggestSet(10, 15, 8,
            [Exposure(15, 7, null) with { IsRepRangeTransition = true }], "normal", 2.5);
        Assert.Equal(7, result.SuggestedReps);
        Assert.True(result.IsRepRangeTransition);
    }

    [Fact]
    public void Load_grid_does_not_invent_a_weight_at_an_off_grid_upper_limit()
    {
        var loads = new LoadOptions(3, MaximumKg: 10);
        Assert.Equal(9, loads.Next(9));
        Assert.Equal(9, loads.AtMost(10));
    }
}
