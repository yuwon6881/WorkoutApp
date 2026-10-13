using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportCoachedHoldTargetsTests
{
    [Theory]
    [InlineData("HOLD", "Hold DBs in stretched position for 60 seconds, add time each week", "60 seconds")]
    [InlineData("HOLD", "Hold dumbbells in the top of the lateral raise for 30 seconds", "30 seconds")]
    [InlineData("HOLD", "Hold for 30-45 seconds", "30-45 seconds")]
    [InlineData("HOLD", "Hold for as long as possible for a max hold of up to 1 minute", "HOLD")]
    [InlineData("HOLD", "Hold at the top of each rep for 2 seconds", "HOLD")]
    [InlineData("HOLD", "Hold the position. Rest for 60 seconds", "HOLD")]
    [InlineData("HOLD", "Hold for 20 seconds. Hold for 30 seconds", "HOLD")]
    [InlineData("MAX HOLD", "Hold for 60 seconds", "MAX HOLD")]
    [InlineData("10-12", "Hold at the top for 2 seconds", "10-12")]
    [InlineData("45 SEC", "Hold for 30 seconds", "45 SEC")]
    public void Only_a_unique_explicit_hold_time_supplies_the_missing_target(string reps, string note, string expected)
        => Assert.Equal(expected, ImportHoldTargets.FromCoaching(reps, note));

    [Fact]
    public void Actual_table_preserves_time_without_rep_bounds_and_keeps_the_note()
    {
        const string note = "Hold dumbbells in the top of the lateral raise for 30 seconds";
        var program = new AiProgram("Shoulder", [new AiDay(null, null, 1, 1, "Day 1", false, null,
            [new AiExercise("Lateral Hold", null, null, [], SourcePage: 1)], 1)]);
        var source = $"=== PAGE 1 ===\nDAY LABEL: DAY 1\nExercise | Sets | Reps | RPE | Rest | Notes\nLateral Hold | 2 | HOLD | 8 | 1 MIN | {note}";
        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, source).Days!).Exercises);
        Assert.All(exercise.Sets, set =>
        {
            Assert.Equal("30 seconds", set.RepsText);
            Assert.Null(ImportNormalization.Reps(set.RepMin, set.RepMax, set.RepsText).Min);
        });
        Assert.Equal(note, exercise.CoachingNotes);
    }

    [Theory]
    [InlineData(8)]
    [InlineData(9)]
    [InlineData(10)]
    public void Amrap_does_not_invent_failure(double effort)
    {
        var set = ImportSetKinds.Tagged(new DraftSet(null, null, effort, 120, null, null, null, RepsText: "AMRAP"));
        Assert.Equal("AMRAP", set.Notes);
        Assert.Equal(effort, set.TargetRpe);
    }

    [Fact]
    public void Legacy_app_owned_failure_label_is_repaired_on_a_reserved_amrap()
    {
        var set = ImportSetKinds.Tagged(new DraftSet(null, null, 8, 120, null, null,
            "Keep controlled — To failure / AMRAP", RepsText: "AMRAP"));
        Assert.Equal("Keep controlled — AMRAP", set.Notes);
    }

    [Theory]
    [InlineData("Dumbbell Lateral Raise (MYO-REP)", "Myo-reps")]
    [InlineData("Myo Reps Floor Skull Crusher", "Myo-reps")]
    [InlineData("Cable Reverse Flye (Mechanical Dropset)", "Dropset")]
    [InlineData("Dumbbell Lateral Raise (DROP SET)", "Dropset")]
    public void Printed_name_methods_apply_even_without_a_technique_column(string name, string expected)
    {
        var program = new AiProgram("Example", [new AiDay(null, null, 1, 1, "Day 1", false, null,
            [new AiExercise(name, null, null, [], SourcePage: 1)], 1)]);
        var source = $"=== PAGE 1 ===\nDAY LABEL: DAY 1\nExercise | Sets | Reps | RPE | Rest | Notes\n{name} | 3 | 12 | 9 | 1 MIN | Keep controlled";
        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, source).Days!).Exercises);
        Assert.All(exercise.Sets, set => Assert.Equal(expected, set.Notes));
    }
}
