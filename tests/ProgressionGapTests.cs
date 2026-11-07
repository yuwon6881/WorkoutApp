using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Regression coverage for the evidence-based gaps: RIR tapers, alternating heavy/light days,
/// time off, easy-set calibration, plateaus and an unplanned bodyweight loss.
public sealed class ProgressionGapTests
{
    private static readonly DateTime Now = new(2026, 9, 29, 12, 0, 0, DateTimeKind.Utc);

    private static SetExposure Exposure(double load, int reps, string? rir, int daysAgo = 3, int min = 8, int max = 10, string? targetRir = "2")
        => new(Guid.NewGuid(), Now.AddDays(-daysAgo), load, reps, null, Rir: rir,
            RepMin: min, RepMax: max, TargetRir: targetRir, HasPrescription: true);

    private static SetProgressionSuggestion Suggest(int min, int max, string? rir, IReadOnlyList<SetExposure> history,
        string mode = ProgressionModes.Normal, DateTime? now = null)
        => Progression.Suggest(new SetPrescription(min, max, null, null, null, null, null, Rir: rir), history, mode,
            new LoadOptions(2.5), now: now ?? Now);

    // Gap 1: a weekly RIR taper must not hold the load for the whole block.
    [Fact]
    public void A_falling_rir_target_still_earns_a_load_increase_from_equivalent_reps()
    {
        // Last week: 10 reps (the ceiling) with 3 in reserve against a RIR 3 target. This week's target is RIR 2.
        var result = Suggest(8, 10, "2", [Exposure(50, 10, "3", targetRir: "3")]);

        Assert.Equal(52.5, result.SuggestedLoadKg);
        Assert.DoesNotContain("Earn", result.Reason);
    }

    [Fact]
    public void A_falling_rir_target_does_not_hide_a_set_that_was_harder_than_last_targets()
    {
        // One in reserve against a RIR 3 target was already harder than asked, so nothing is inflated.
        var result = Suggest(8, 10, "2", [Exposure(50, 10, "1", targetRir: "3")]);

        Assert.True(result.SuggestedLoadKg <= 50);
    }

    // Gap 2: alternating heavy and light days keep their own progression, and a deload week is not evidence.
    [Fact]
    public void An_alternating_range_uses_the_matching_days_history()
    {
        var history = new List<SetExposure>
        {
            Exposure(30, 15, "2", daysAgo: 3, min: 12, max: 15),
            Exposure(50, 10, "2", daysAgo: 7, min: 8, max: 10)
        };

        var result = Suggest(8, 10, "2", history);

        Assert.Equal(52.5, result.SuggestedLoadKg);
    }

    [Fact]
    public void A_different_rep_target_after_a_layoff_does_not_inherit_the_old_rep_count()
    {
        var result = Suggest(8, 8, "2", [Exposure(100, 2, "2", daysAgo: 21, min: 2, max: 2)]);
        Assert.Equal(8, result.SuggestedReps);
    }

    [Fact]
    public void A_long_layoff_retargets_before_reducing_the_heavy_day_load()
    {
        var result = Suggest(8, 8, "2", [Exposure(100, 2, "2", daysAgo: 35, min: 2, max: 2)]);
        Assert.Equal(8, result.SuggestedReps);
        Assert.True(result.SuggestedLoadKg is null or < 100);
    }

    [Fact]
    public void An_eight_rep_day_uses_its_own_history_after_a_two_rep_day()
    {
        var result = Suggest(8, 8, "2", [
            Exposure(100, 2, "2", daysAgo: 2, min: 2, max: 2),
            Exposure(70, 8, "2", daysAgo: 6, min: 8, max: 8)]);
        Assert.True(result.SuggestedReps >= 8);
        Assert.Equal(70, result.PreviousLoadKg);
    }

    [Fact]
    public void A_first_eight_rep_day_does_not_use_two_as_its_target()
    {
        var result = Suggest(8, 8, "2", [Exposure(100, 2, "2", daysAgo: 2, min: 2, max: 2)]);
        Assert.Equal(8, result.SuggestedReps);
    }

    [Fact]
    public void A_pause_set_does_not_reuse_the_straight_set_history()
    {
        var paused = new SetPrescription(8, 8, null, null, null, null, "Pause set", Rir: "2");
        var straight = Exposure(100, 8, "2", daysAgo: 2, min: 8, max: 8);
        var result = Progression.Suggest(paused, [straight], ProgressionModes.Normal, new LoadOptions(2.5), now: Now);
        Assert.Null(result.SuggestedLoadKg);
    }

    [Fact]
    public void The_session_after_a_deload_week_returns_to_the_pre_deload_load()
    {
        var history = new List<SetExposure>
        {
            Exposure(40, 10, "5+", daysAgo: 3, targetRir: "5"),
            Exposure(60, 8, "2", daysAgo: 10)
        };

        var result = Suggest(8, 10, "2", history);

        Assert.Equal(60, result.SuggestedLoadKg);
    }

    // Gap 3: strength decays after time off, so the suggestion must too.
    [Theory]
    [InlineData(10, 62.5)]
    [InlineData(20, 60)]
    [InlineData(35, 52.5)]
    [InlineData(70, 47.5)]
    public void Time_off_holds_or_reduces_the_load(int daysAgo, double expectedLoad)
    {
        var result = Suggest(8, 10, "2", [Exposure(60, 10, "2", daysAgo: daysAgo)]);

        Assert.Equal(expectedLoad, result.SuggestedLoadKg);
    }

    [Theory]
    [InlineData(10, 10, 6)]
    [InlineData(10, 12, 5)]
    public void A_layoff_hold_repeats_the_reps_last_achieved_not_the_range_minimum(int min, int max, int reps)
    {
        // 25 kg for 6 (or 5) against a 10-rep target, three weeks ago with no effort logged: "repeat
        // your last session" must ask for those reps again, not 25 kg for the full 10.
        var result = Suggest(min, max, null, [Exposure(25, reps, null, daysAgo: 21, min: min, max: max, targetRir: null)]);

        Assert.Equal(25, result.SuggestedLoadKg);
        Assert.Equal(reps, result.SuggestedReps);
        Assert.Contains("21 days", result.Reason);
    }

    [Fact]
    public void A_layoff_never_asks_for_more_than_training_through_would()
    {
        // A far miss with its effort logged is re-aimed lighter when trained through; a break must
        // not instead hold the heavier load.
        var history = new List<SetExposure> { Exposure(25, 6, "0", daysAgo: 21, min: 10, max: 10) };
        var through = Suggest(10, 10, "2", [history[0] with { CompletedAt = Now.AddDays(-3) }]);
        var away = Suggest(10, 10, "2", history);

        Assert.True(through.SuggestedLoadKg < 25);
        Assert.Equal(through.SuggestedLoadKg, away.SuggestedLoadKg);
        Assert.Equal(through.SuggestedReps, away.SuggestedReps);
        Assert.Contains("21 days", away.Reason);
    }

    [Fact]
    public void A_layoff_reason_names_the_time_away()
    {
        var result = Suggest(8, 10, "2", [Exposure(60, 10, "2", daysAgo: 35)]);

        Assert.Contains("35 days", result.Reason);
    }

    [Fact]
    public void Sessions_done_with_another_technique_are_not_time_away()
    {
        // Straight sets 30 days ago, lengthened partials in the same slot last week: the movement was
        // trained a week ago, so the straight set progresses normally instead of easing back in.
        var straight = Exposure(50, 10, "2", daysAgo: 30);
        var partial = Exposure(50, 6, "0", daysAgo: 7) with { Technique = SetTechniques.LengthenedPartials };

        var result = Suggest(8, 10, "2", [partial, straight]);

        Assert.Equal(52.5, result.SuggestedLoadKg);
        Assert.DoesNotContain("days away", result.Reason);
    }

    [Fact]
    public void A_layoff_that_cannot_lighten_the_load_does_not_claim_it_did()
    {
        // 10 kg is already the lightest available weight, and a reps-only movement has no load at all.
        var lightest = Progression.Suggest(new SetPrescription(8, 10, null, null, null, null, null, Rir: "2"),
            [Exposure(10, 10, "2", daysAgo: 35)], ProgressionModes.Normal,
            new LoadOptions(0, AvailableLoadsKg: [10, 12, 14]), now: Now);
        var repsOnly = Progression.Suggest(new SetPrescription(8, 10, null, null, null, null, null, Rir: "2"),
            [Exposure(0, 10, "2", daysAgo: 35)], ProgressionModes.Normal, new LoadOptions(2.5),
            resistanceMode: ResistanceModes.RepsOnly, now: Now);

        Assert.Equal(10, lightest.SuggestedLoadKg);
        Assert.DoesNotContain("lighter", lightest.Reason);
        Assert.Contains("35 days", lightest.Reason);
        Assert.Null(repsOnly.SuggestedLoadKg);
        Assert.DoesNotContain("lighter", repsOnly.Reason);
    }

    [Theory]
    [InlineData("1-2")]
    [InlineData("1–2")]
    [InlineData("1+")]
    public void A_ranged_rir_target_still_sets_the_effort_goal(string target)
    {
        // Ten reps taken to failure did not stay within a 1-2 RIR target, so the load must not rise.
        var failed = Suggest(8, 10, target, [Exposure(50, 10, "0", targetRir: target)]);
        var met = Suggest(8, 10, target, [Exposure(50, 10, "1", targetRir: target)]);

        Assert.Equal(50, failed.SuggestedLoadKg);
        Assert.Equal(52.5, met.SuggestedLoadKg);
    }

    // Gap 4: an unplanned loss rate on a maintain or gain goal is protected like a cut.
    [Theory]
    [InlineData("maintain", .6, 14, ProgressionModes.Conservative)]
    [InlineData("gain", .5, 21, ProgressionModes.Conservative)]
    [InlineData("gain", .49, 21, ProgressionModes.Normal)]
    [InlineData("maintain", .6, 7, ProgressionModes.Normal)]
    [InlineData("maintain", -.4, 21, ProgressionModes.Normal)]
    [InlineData("maintain", null, null, ProgressionModes.Normal)]
    public void An_unplanned_deficit_on_a_maintain_or_gain_goal_selects_conservative(string goal, double? loss, int? days, string expected)
    {
        var context = new NutritionTrainingContext("subject", 1, "UTC", goal, false, null, loss, days, 80, null, 79, null, Now, true);

        Assert.Equal(expected, NutritionContextService.Mode(context, Now));
    }

    // A qualified scale trend outranks the stated cut rate: a cut that is not losing weight is not a
    // deficit, and the measured rate, not the planned one, picks the tier.
    [Theory]
    [InlineData(1.0, -.3, 21, ProgressionModes.Normal)]
    [InlineData(1.0, 0.0, 14, ProgressionModes.Normal)]
    [InlineData(1.0, .4, 21, ProgressionModes.Conservative)]
    [InlineData(.5, .8, 21, ProgressionModes.Preservation)]
    [InlineData(1.0, -.3, 7, ProgressionModes.Preservation)]
    [InlineData(1.0, null, null, ProgressionModes.Preservation)]
    public void A_qualified_observed_rate_decides_the_tier_for_a_loss_goal(double? target, double? loss, int? days, string expected)
    {
        var context = new NutritionTrainingContext("subject", 1, "UTC", "lose", false, target, loss, days, 80, null, 79, null, Now, true);

        Assert.Equal(expected, NutritionContextService.Mode(context, Now));
    }

    [Fact]
    public void An_unconfirmed_or_stale_context_never_triggers_the_guard()
    {
        var unconfirmed = new NutritionTrainingContext("subject", 1, "UTC", "maintain", false, null, .9, 21, 80, null, 79, null, Now, false);
        var stale = new NutritionTrainingContext("subject", 1, "UTC", "maintain", false, null, .9, 21, 80, null, 79, null, Now.AddDays(-8), true);

        Assert.Equal(ProgressionModes.Normal, NutritionContextService.Mode(unconfirmed, Now));
        Assert.Equal(ProgressionModes.Normal, NutritionContextService.Mode(stale, Now));
    }

    // Gap 5: a set far easier than the target calibrates faster, but only in normal mode and only within a cap.
    [Fact]
    public void A_set_well_below_the_target_effort_takes_a_capped_larger_jump()
    {
        var result = Suggest(8, 10, "1", [Exposure(50, 10, "5+", targetRir: "1")]);

        Assert.True(result.SuggestedLoadKg > 52.5);
        Assert.True(result.SuggestedLoadKg <= 55);
    }

    [Fact]
    public void A_moderately_easy_set_still_takes_one_step()
    {
        var result = Suggest(8, 10, "1", [Exposure(50, 10, "2", targetRir: "1")]);

        Assert.Equal(52.5, result.SuggestedLoadKg);
    }

    [Fact]
    public void Reps_far_past_the_top_of_the_range_take_the_capped_larger_jump()
    {
        // Twenty reps at the target effort on an 8-10 set: the load is far too light, like a 5+ RIR set.
        var far = Suggest(8, 10, "2", [Exposure(50, 20, "2")]);
        var justOver = Suggest(8, 10, "2", [Exposure(50, 11, "2")]);

        Assert.Equal(55, far.SuggestedLoadKg);
        Assert.Equal(52.5, justOver.SuggestedLoadKg);
    }

    [Fact]
    public void Conservative_mode_does_not_take_the_calibration_jump()
    {
        var history = new List<SetExposure>
        {
            Exposure(50, 10, "5+", daysAgo: 3, targetRir: "1"),
            Exposure(50, 10, "5+", daysAgo: 10, targetRir: "1")
        };

        var result = Suggest(8, 10, "1", history, ProgressionModes.Conservative);

        Assert.Equal(52.5, result.SuggestedLoadKg);
    }

    [Fact]
    public void An_easy_set_inside_the_range_adds_more_than_one_rep()
    {
        var result = Suggest(8, 12, "1", [Exposure(50, 8, "4", min: 8, max: 12, targetRir: "1")]);

        Assert.Equal(50, result.SuggestedLoadKg);
        Assert.Equal(11, result.SuggestedReps);
    }

    // Gap 6: four sessions with no rep gain at the target effort reset the load in normal mode.
    private static List<SetExposure> Stalled() =>
    [
        Exposure(50, 8, "2", daysAgo: 3), Exposure(50, 8, "2", daysAgo: 10),
        Exposure(50, 8, "2", daysAgo: 17), Exposure(50, 8, "2", daysAgo: 24)
    ];

    [Fact]
    public void A_plateau_resets_five_percent_in_normal_mode()
    {
        var result = Suggest(8, 10, "2", Stalled());

        Assert.Equal(47.5, result.SuggestedLoadKg);
        Assert.Contains("4 sessions", result.Reason);
    }

    // A deficit keeps the load (no reset) but still asks for overload: one more rep at it.
    [Theory]
    [InlineData(ProgressionModes.Conservative)]
    [InlineData(ProgressionModes.Preservation)]
    public void A_plateau_during_a_deficit_keeps_the_load_and_aims_for_one_more_rep(string mode)
    {
        var result = Suggest(8, 10, "2", Stalled(), mode);

        Assert.Equal(50, result.SuggestedLoadKg);
        Assert.Equal(9, result.SuggestedReps);
        Assert.Contains("deficit", result.Reason);
    }

    [Fact]
    public void Improving_reps_is_not_a_plateau()
    {
        var history = new List<SetExposure>
        {
            Exposure(50, 9, "2", daysAgo: 3), Exposure(50, 8, "2", daysAgo: 10),
            Exposure(50, 8, "2", daysAgo: 17), Exposure(50, 8, "2", daysAgo: 24)
        };

        Assert.Equal(50, Suggest(8, 10, "2", history).SuggestedLoadKg);
    }

    // Gap 7: RIR-only sets feed the strength trend.
    [Theory]
    [InlineData("2", 8.0)]
    [InlineData("0", 10.0)]
    [InlineData("4", 6.0)]
    [InlineData("5+", null)]
    [InlineData(null, null)]
    [InlineData("junk", null)]
    public void Rir_converts_to_rpe_only_when_it_is_a_number_from_zero_to_four(string? rir, double? expected)
        => Assert.Equal(expected, Progression.RpeFromRir(rir));
}
