using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

public sealed class PercentageLoadTests
{
    private static readonly LoadOptions Step = new(2.5);

    private static SetPrescription Plan(string? load, double? rpe = null, bool warmup = false)
        => new(3, 3, rpe, 180, null, load, null, Warmup: warmup);

    private static SetProgressionSuggestion Engine(double? load, bool hasHistory)
        => new(load, 3, "engine reason", hasHistory ? Guid.NewGuid() : null, hasHistory ? DateTime.UtcNow : null, ProgressionModes.Normal, null);

    [Theory]
    [InlineData("75%", 75, 75)]
    [InlineData("75% 1RM", 75, 75)]
    [InlineData("80-85%", 80, 85)]
    [InlineData("82.5–87.5% 1RM", 82.5, 87.5)]
    public void Reads_the_printed_percentage_or_band(string text, double low, double high)
    {
        var band = PercentageLoad.Parse(text);
        Assert.Equal(low, band!.Value.Low);
        Assert.Equal(high, band.Value.High);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("add weight if needed")]
    [InlineData("140 kg")]
    [InlineData("150%")]
    [InlineData("85-80%")]
    public void Leaves_other_load_text_alone(string? text) => Assert.Null(PercentageLoad.Parse(text));

    [Fact]
    public void A_back_off_set_follows_its_percentage_whatever_the_last_load_was()
    {
        var result = PercentageLoad.Apply(Plan("75%"), Engine(60, true), 100, false, Step);

        Assert.Equal(75, result.SuggestedLoadKg);
        Assert.Equal(3, result.SuggestedReps);
        Assert.Contains("75%", result.Reason);
    }

    [Fact]
    public void A_week_with_a_higher_percentage_raises_the_load()
    {
        var week1 = PercentageLoad.Apply(Plan("70%"), Engine(70, true), 140, false, Step);
        var week2 = PercentageLoad.Apply(Plan("80%"), Engine(70, true), 140, false, Step);

        Assert.Equal(97.5, week1.SuggestedLoadKg);
        Assert.Equal(112.5, week2.SuggestedLoadKg);
    }

    [Fact]
    public void A_top_set_uses_the_middle_of_its_band_and_keeps_its_effort_target_whatever_the_history_says()
    {
        foreach (var last in new double?[] { null, 70, 87.5, 95 })
        {
            var result = PercentageLoad.Apply(Plan("82.5-87.5%", 8.5), Engine(last, last is not null), 100, true, Step);

            Assert.Equal(85, result.SuggestedLoadKg);
            Assert.Equal(3, result.SuggestedReps);
            Assert.Contains("Middle of the band", result.Reason);
            Assert.Contains("estimated 1RM", result.Reason);
            Assert.Contains("target effort", result.Reason);
        }
    }

    [Fact]
    public void Without_a_one_rep_max_the_load_stays_blank_instead_of_borrowing_ordinary_progression()
    {
        var result = PercentageLoad.Apply(Plan("75%"), Engine(60, true), null, false, Step);

        Assert.Null(result.SuggestedLoadKg);
        Assert.Equal(3, result.SuggestedReps);
        Assert.Contains("Enter your 1RM", result.Reason);
    }

    [Fact]
    public void The_programs_reps_replace_the_progression_reps()
    {
        var engine = Engine(60, true) with { SuggestedReps = 8 };

        Assert.Equal(3, PercentageLoad.Apply(Plan("75%"), engine, 100, false, Step).SuggestedReps);
    }

    [Fact]
    public void Warm_ups_plain_loads_and_reps_only_movements_are_left_alone()
    {
        var engine = Engine(60, true);
        Assert.Same(engine, PercentageLoad.Apply(Plan("75%", warmup: true), engine, 100, false, Step));
        Assert.Same(engine, PercentageLoad.Apply(Plan("RPE note"), engine, 100, false, Step));
        var repsOnly = engine with { ResistanceMode = ResistanceModes.RepsOnly };
        Assert.Same(repsOnly, PercentageLoad.Apply(Plan("75%"), repsOnly, 100, false, Step));
    }

    [Fact]
    public void A_one_rep_max_is_estimated_from_the_best_recent_heavy_set()
    {
        SetExposure Hit(double load, int reps, double? rpe, int daysAgo)
            => new(Guid.NewGuid(), DateTime.UtcNow.AddDays(-daysAgo), load, reps, rpe);

        var estimate = PercentageLoad.EstimateOneRepMax([Hit(100, 5, 8, 3), Hit(60, 15, 8, 1), Hit(90, 5, 8, 10)]);

        Assert.Equal(100 * (1 + 7 / 30.0), estimate!.Value, 6);
        Assert.Null(PercentageLoad.EstimateOneRepMax([Hit(40, 15, 8, 1)]));
        Assert.Null(PercentageLoad.EstimateOneRepMax([]));
    }
}
