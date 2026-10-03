using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

/// A later set that dips because an earlier set of the same exercise was pushed past its target
/// effort is carrying fatigue, not showing lost strength.
public sealed class ProgressionFatigueTests
{
    private static readonly SetPrescription TargetRir2 = new(8, 10, null, 90, null, null, null, Rir: "2");
    private static readonly SetPrescription NoEffortTarget = new(8, 10, null, 90, null, null, null);

    private static SetExposure Exposure(int weeksAgo, int reps, string rir, double? priorOvershoot = null,
        double? priorReserve = null, SetPrescription? prescription = null)
    {
        var plan = prescription ?? TargetRir2;
        return new(Guid.NewGuid(), DateTime.UtcNow.AddDays(-1 - 7 * weeksAgo), 60, reps, null, Rir: rir,
            RepMin: plan.RepMin, RepMax: plan.RepMax, TargetRpe: plan.TargetRpe, TargetRir: plan.Rir, HasPrescription: true,
            PriorOvershoot: priorOvershoot, PriorReserve: priorReserve);
    }

    private static SetProgressionSuggestion Suggest(SetPrescription prescription, params SetExposure[] history)
        => Progression.Suggest(prescription, history, ProgressionModes.Normal, new LoadOptions(2.5), now: DateTime.UtcNow);

    [Fact]
    public void A_below_range_set_after_an_earlier_set_overshot_holds_the_load_and_aims_for_its_fresh_reps()
    {
        var result = Suggest(TargetRir2,
            Exposure(0, 6, "2", priorOvershoot: 2),
            Exposure(1, 9, "2", priorOvershoot: 0));

        Assert.Equal(60, result.SuggestedLoadKg);
        Assert.Equal(9, result.SuggestedReps);
        Assert.Contains("fatigue", result.Reason);
    }

    [Fact]
    public void Two_fatigued_hard_sessions_do_not_count_as_a_hard_streak()
    {
        var result = Suggest(TargetRir2,
            Exposure(0, 7, "1", priorOvershoot: 2),
            Exposure(1, 7, "1", priorOvershoot: 2),
            Exposure(2, 9, "2", priorOvershoot: 0));

        Assert.Equal(60, result.SuggestedLoadKg);
        Assert.Equal(9, result.SuggestedReps);
        Assert.Contains("fatigue", result.Reason);
    }

    [Fact]
    public void A_dip_that_persists_beyond_the_excuse_limit_is_treated_as_real()
    {
        var result = Suggest(TargetRir2,
            Exposure(0, 7, "1", priorOvershoot: 2),
            Exposure(1, 7, "1", priorOvershoot: 2),
            Exposure(2, 7, "1", priorOvershoot: 2),
            Exposure(3, 9, "2", priorOvershoot: 0));

        Assert.True(result.SuggestedLoadKg < 60);
        Assert.DoesNotContain("fatigue", result.Reason);
    }

    [Fact]
    public void Without_an_effort_target_earlier_sets_pushed_closer_to_failure_than_before_explain_the_dip()
    {
        var result = Suggest(NoEffortTarget,
            Exposure(0, 6, "1", priorReserve: 0, prescription: NoEffortTarget),
            Exposure(1, 6, "1", priorReserve: 0, prescription: NoEffortTarget),
            Exposure(2, 9, "1", priorReserve: 2, prescription: NoEffortTarget));

        Assert.Equal(60, result.SuggestedLoadKg);
        Assert.Equal(9, result.SuggestedReps);
        Assert.Contains("fatigue", result.Reason);
    }

    [Fact]
    public void Earlier_sets_at_their_target_do_not_excuse_a_genuinely_hard_set()
    {
        var result = Suggest(TargetRir2,
            Exposure(0, 7, "1", priorOvershoot: 0),
            Exposure(1, 7, "1", priorOvershoot: 0));

        Assert.Equal(57.5, result.SuggestedLoadKg);
        Assert.DoesNotContain("fatigue", result.Reason);
    }

    [Fact]
    public void Earlier_effort_reports_the_largest_overshoot_and_the_lowest_reserve()
    {
        var effort = ProgressionFatigue.Before([
            new SetEffort("0", null, "2", null),
            new SetEffort("5+", null, null, 8),
            new SetEffort(null, null, "2", null)
        ]);

        Assert.Equal(2, effort.Overshoot);
        Assert.Equal(0, effort.Reserve);
        Assert.Equal(new EarlierEffort(null, null), ProgressionFatigue.Before([]));
    }
}
