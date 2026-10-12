using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportHoldColumnTests
{
    [Theory]
    [InlineData("HOLD", "20 SEC", "20 SEC")]
    [InlineData("HOLD", "MAX HOLD", "MAX HOLD")]
    [InlineData("HOLD", "MAX STRIDES", "MAX STRIDES")]
    [InlineData("-", "30 SEC", "30 SEC")]
    [InlineData("HOLD", "-", "HOLD")]
    [InlineData("10-12", "20 SEC", "10-12")]
    public void Separate_hold_target_is_recovered_without_replacing_repetitions(string reps, string hold, string expected)
    {
        var program = new AiProgram("Grip", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Barbell Hold", null, null,
                [new AiSet(8, 8, null, null, null, null, null, RepsText: "8")], SourcePage: 6)
        ], 6)]);
        var source = $"""
            === PAGE 6 ===
            DAY LABEL: DAY 1
            DAY 1 | SETS | REPS | HOLD | RPE | REST | NOTES
            Barbell Hold | 2 | {reps} | {hold} | 8 | 40 SEC | Keep a firm grip
            """;
        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, source).Days!).Exercises);
        Assert.Equal(2, exercise.Sets.Count);
        Assert.All(exercise.Sets, set =>
        {
            Assert.Equal(expected, set.RepsText);
            Assert.Equal(40, set.RestSeconds);
            var bounds = ImportNormalization.Reps(set.RepMin, set.RepMax, set.RepsText);
            Assert.Equal(reps == "10-12" ? (10, 12) : ((int?)null, (int?)null), (bounds.Min, bounds.Max));
        });
    }
}
