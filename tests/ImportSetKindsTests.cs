using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Shoulder Hypertrophy's last Day 1 prints the overhead press as two warm-up rows under the same
/// name and an AMRAP test set: SETS 1 / 2 / 1, REPS 8-10 / 4-6 / AMRAP, and no warm-up column.
public sealed class ImportSetKindsTests
{
    private const string ShoulderPage = """
        === PAGE 15 ===
        DAY LABEL: DAY 1
        Exercise | SETS | REPS | %1RM RPE | REST | 1 | 2 | 3 | 4 | NOTES | LSRPE
        CABLE EXTERNAL ROTATION | 2 | 12-15 | 7 | 0.5 |  |  |  |  | AVOID FAILURE, KEEP ELBOW TUCKED IN, SHORT ROM
        STANDING OVERHEAD BARBELL PRESS (WARM UP) | 1 | 8-10 | 50% 5 | 2.0 |  |  |  |  | WARM UP SET TO REHEARSE TECHNIQUE
        STANDING OVERHEAD BARBELL PRESS (WARM UP) | 2 | 4-6 | 60-70% 6 | 2.0 |  |  |  |  | WARM UP SET TO GET USED TO HEAVIER LOADING
        STANDING OVERHEAD BARBELL PRESS | 1 | AMRAP | 90% 9.5 | 3.0 |  |  |  |  | AS MANY REPS AS POSSIBLE (AMRAP)
        """;

    [Fact]
    public void Same_named_rows_pair_in_order_and_a_table_without_a_warmup_column_adds_no_warmups()
    {
        AiExercise Press(string name, string? warmups) => new(name, null, null,
            [new AiSet(4, 6, null, null, null, null, null)], WarmupSets: warmups, SourcePage: 15);
        var program = new AiProgram("Shoulder", [new AiDay("Block 2", null, 12, 1, "Day 1", false, null, [
            Press("STANDING OVERHEAD BARBELL PRESS (WARM UP)", null),
            Press("STANDING OVERHEAD BARBELL PRESS (WARM UP)", "2"),
            Press("STANDING OVERHEAD BARBELL PRESS", null)
        ], 15)]);

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, ShoulderPage).Days!).Exercises;

        // The page is a clean table, so the cable row the read left out comes back first.
        Assert.Equal("CABLE EXTERNAL ROTATION", exercises[0].SourceName);
        Assert.Equal([2, 1, 2, 1], exercises.Select(exercise => exercise.Sets.Count));
        Assert.Equal(["12-15", "8-10", "4-6", "AMRAP"], exercises.Select(exercise => exercise.Sets[0].RepsText));
        Assert.All(exercises, exercise => Assert.Null(exercise.WarmupSets));
    }

    [Fact]
    public void A_warmup_row_is_its_own_warmups_with_nothing_added_in_front()
    {
        var printed = new DraftSet(4, 6, 6, 120, null, "60-70% 1RM", null, Rir: "4");

        var sets = ImportSetKinds.Compose([printed, printed], warmups: 2, "STANDING OVERHEAD BARBELL PRESS (WARM UP)");

        Assert.Equal(2, sets.Count);
        Assert.All(sets, set => Assert.True(set.Warmup));
        Assert.All(sets, set => Assert.Null(set.TargetRpe));
        Assert.All(sets, set => Assert.Equal("60-70% 1RM", set.LoadText));
    }

    [Fact]
    public void A_stated_warmup_count_still_precedes_an_ordinary_row()
    {
        var printed = new DraftSet(8, 10, 8, 120, null, null, ImportSetKinds.AmrapNote);

        var sets = ImportSetKinds.Compose([printed], warmups: 2, "Barbell Row");

        Assert.Equal([true, true, false], sets.Select(set => set.Warmup));
        Assert.Null(sets[0].Notes);
    }

    [Theory]
    [InlineData("AMRAP")]
    [InlineData("Max reps")]
    [InlineData("To failure")]
    public void Open_ended_reps_are_tagged_as_amrap(string reps)
    {
        var set = ImportSetKinds.Tagged(new DraftSet(1, 1, 10, 180, null, null, null, RepsText: reps));

        Assert.Equal(ImportSetKinds.AmrapNote, set.Notes);
    }

    [Fact]
    public void A_counted_row_is_not_tagged()
    {
        var set = new DraftSet(8, 10, 8, 120, null, null, null, RepsText: "8-10");

        Assert.Same(set, ImportSetKinds.Tagged(set));
        Assert.False(ImportSetKinds.IsWarmupRow("Warm Up Walk"));
        Assert.True(ImportSetKinds.IsWarmupRow("Leg Press - Warm-up"));
    }
}
