using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportCoachingTechniqueTests
{
    [Theory]
    [InlineData("12/20", "On the last set only: do 12 reps, drop the weight 50% and do 20 more reps", "Dropset", "12")]
    [InlineData("10-12 (dropset)", "Last set only do a dropset: perform 10-12 reps, drop the weight, perform an additional 10-12 reps", "Dropset", "10-12")]
    [InlineData("10(+3+3+3)", "On the last set only: do 10 reps to failure. Rest 3-4 seconds. Do another 3 reps. Rest 2-3 seconds. Do another 3 reps", "Myo-reps", "10")]
    public void Final_set_extension_leaves_earlier_sets_straight(string reps, string note, string method, string baseReps)
    {
        var exercise = Read(reps, note);
        Assert.Equal([baseReps, baseReps, reps], exercise.Sets.Select(set => set.RepsText));
        Assert.All(exercise.Sets.Take(2), set => Assert.Null(set.Notes));
        Assert.Equal(method, exercise.Sets[^1].Notes);
        Assert.Equal(note, exercise.CoachingNotes);
    }

    [Theory]
    [InlineData("10/15", "Dropset: do 10 reps, lower the weight, do another 15 reps", "Dropset")]
    [InlineData("8-10(+4+4)", "Do 8-10 reps to failure. Rest 3-4 seconds. Do another 4 reps. Rest 2-3 seconds. Do another 4 reps", "Myo-reps")]
    [InlineData("10-12", "Myo-reps", "Myo-reps")]
    public void Unqualified_coaching_method_applies_to_all_working_sets(string reps, string note, string method)
    {
        var exercise = Read(reps, note);
        Assert.All(exercise.Sets, set => { Assert.Equal(reps, set.RepsText); Assert.Equal(method, set.Notes); });
    }

    [Theory]
    [InlineData("7/7/7", "First 7 reps: top half ROM. Middle 7 reps: full ROM. Last 7 reps: bottom half ROM")]
    [InlineData("10/15", "Avoid dropsets")]
    [InlineData("10(+3+3+3)", "Maintain form")]
    [InlineData("10-12", "Drop the weight back and focus on controlling the negative")]
    [InlineData("4, 6, 8", "We're using a reverse pyramid. Then for set 2, drop the weight back 10-15% and do 6 reps. Then for set 3, drop the weight back another 10-15% and do 8 reps")]
    public void Ambiguous_notation_or_discussion_does_not_invent_an_intensity_method(string reps, string note)
    {
        var exercise = Read(reps, note);
        Assert.All(exercise.Sets, set =>
        {
            Assert.Equal(reps, set.RepsText);
            Assert.DoesNotContain("Dropset", set.Notes ?? "");
            Assert.DoesNotContain("Myo-reps", set.Notes ?? "");
        });
    }

    [Fact]
    public void Technique_prescription_excludes_only_the_extended_set_from_strength()
    {
        var exercise = Read("12/20", "Dropset on last set only");
        Assert.Equal([null, null, SetTechniques.DropSet], exercise.Sets.Select(set =>
            SetTechniques.Of(set.Notes)));
    }

    [Fact]
    public void Top_and_bottom_end_rom_segments_are_partial_rep_work()
    {
        var exercise = Read("10+5+5", "10 REPS FULL ROM, 5 REPS TOP END ROM, 5 REPS BOTTOM END ROM");
        Assert.All(exercise.Sets, set => Assert.Equal("Partial reps", set.Notes));
    }

    /// Arm Hypertrophy cues where in the range to act ("press rope apart at the top end ROM",
    /// "at bottom end ROM arms should be aligned vertically"); every set had been tagged partial reps.
    [Theory]
    [InlineData("PERFORM BOTH ARMS AT ONCE, PRESS ROPE APART AT THE TOP END ROM")]
    [InlineData("USE BARBELL OR EZ BAR, AT BOTTOM END ROM ARMS SHOULD BE ALLIGNED VERTICALLY")]
    public void A_cue_placed_at_the_end_of_the_range_is_not_partial_reps(string note)
    {
        var exercise = Read("12-15", note);
        Assert.All(exercise.Sets, set => Assert.Null(set.Notes));
    }

    [Fact]
    public void Ordinary_end_of_rom_coaching_does_not_prescribe_partials()
    {
        var exercise = Read("10-12", "Keep tension at the end of ROM for every rep.");
        Assert.All(exercise.Sets, set => Assert.Null(set.Notes));
    }

    [Fact]
    public void Source_scope_repairs_a_model_tag_on_every_set()
    {
        var program = new AiProgram("Example", [new AiDay(null, null, 1, 1, "Day 1", false, null,
            [new AiExercise("Cable Flye", null, null,
                Enumerable.Range(0, 3).Select(_ => new AiSet(12, 12, 9, 60, null, null, "Dropset", RepsText: "12/20")).ToList(), SourcePage: 1)], 1)]);
        var source = "=== PAGE 1 ===\nDAY LABEL: DAY 1\nExercise | Sets | Reps | RPE | Rest | Notes\nCable Flye | 3 | 12/20 | 9 | 2 MIN | Dropset on last set only";
        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, source).Days!).Exercises);
        Assert.All(exercise.Sets.Take(2), set => Assert.Null(set.Notes));
        Assert.Equal("Dropset", exercise.Sets[^1].Notes);
    }

    private static AiExercise Read(string reps, string note)
    {
        var program = new AiProgram("Example", [new AiDay(null, null, 1, 1, "Day 1", false, null,
            [new AiExercise("Cable Flye", null, null, [], SourcePage: 1)], 1)]);
        var source = $"""
            === PAGE 1 ===
            DAY LABEL: DAY 1
            Exercise | Sets | Reps | RPE | Rest | Notes
            Cable Flye | 3 | {reps} | 9 | 2 MIN | {note}
            """;
        return Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, source).Days!).Exercises);
    }
}
