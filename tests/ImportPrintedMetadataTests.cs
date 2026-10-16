using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportPrintedMetadataTests
{
    // High Frequency Full Body 5x/week, PDF p.65: three squat warm-ups, four work sets.
    [Theory]
    [InlineData("1", "3")]
    [InlineData("8", "3")]
    [InlineData("1", "2-3")]
    [InlineData("3", "0")]
    public async Task Printed_warmups_replace_a_conflicting_read(string readCount, string printedCount)
    {
        var source = $"""
            === PAGE 65 ===
            DAY LABEL: Day 1
            Exercise | Warm-up Sets | Working Sets | Reps | RPE/% | Rest | Notes
            BACK SQUAT | {printedCount} | 4 | 4 | 75% | 2-4 MIN | SIT BACK AND DOWN
            """;
        var read = new AiProgram("Full Body", [new AiDay(null, null, 9, 1, "Day 1", false, null,
            [new AiExercise("BACK SQUAT", null, null, [new AiSet(4, 4, null, 180, null, null, null)],
                WarmupSets: readCount, SourcePage: 65)], 65)]);

        var repaired = ImportTableEvidence.Enrich(read, source);
        Assert.Equal(printedCount, Assert.Single(Assert.Single(repaired.Days!).Exercises).WarmupSets);

        await using var harness = await Harness.Create();
        await harness.SignIn();
        var draft = await harness.Imports(StubHandler.Program("{}")).ToDraft(repaired, default);
        var sets = Assert.Single(Assert.Single(draft.Workouts).Exercises).Sets;
        var count = printedCount == "2-3" ? 2 : int.Parse(printedCount);
        Assert.Equal(count, sets.Count(set => set.Warmup));
        Assert.Equal(4, sets.Count(set => !set.Warmup));
    }

    // Shoulder Hypertrophy, PDF p.14: these rows explicitly print A1/A2.
    [Theory]
    [InlineData(null)]
    [InlineData("B1")]
    [InlineData("A")]
    public void Printed_superset_membership_and_order_replace_a_conflicting_read(string? readGroup)
    {
        const string source = """
            === PAGE 14 ===
            DAY LABEL: Day 1
            Exercise | Sets | Reps | RPE | Rest
            A1. BANDED LATERAL RAISE | 3 | 20 | 10 | 0 MIN
            A2. BANDED FRONT Y RAISE | 3 | 20 | 10 | 1 MIN
            """;
        var read = new AiProgram("Shoulder", [new AiDay(null, null, 7, 1, "Day 1", false, null,
            [new AiExercise("BANDED LATERAL RAISE", null, null, [new AiSet(20, 20, 10, 0, null, null, null)],
                SequenceGroup: readGroup, SourcePage: 14),
             new AiExercise("BANDED FRONT Y RAISE", null, null, [new AiSet(20, 20, 10, 60, null, null, null)],
                SequenceGroup: readGroup, SourcePage: 14)], 14)]);

        var repaired = ImportTableEvidence.Enrich(read, source);
        Assert.Equal(["A1", "A2"], Assert.Single(repaired.Days!).Exercises.Select(exercise => exercise.SequenceGroup));
        Assert.Equal(Json.Write(repaired), Json.Write(ImportTableEvidence.Enrich(repaired, source)));
    }
}
