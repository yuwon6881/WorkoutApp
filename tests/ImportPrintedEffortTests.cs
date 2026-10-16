using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportPrintedEffortTests
{
    [Theory]
    [InlineData("1-9", "1-9")]
    [InlineData("8-11", "8-11")]
    [InlineData("9-8", "9-8")]
    [InlineData("8-9", null)]
    [InlineData("5", null)]
    [InlineData("75%", null)]
    [InlineData("75% 3", "3")]
    [InlineData("75% 4-5", "4-5")]
    [InlineData("N/A", null)]
    [InlineData("2-3 MIN 8", null)]
    public void Only_readable_numeric_effort_outside_the_supported_range_is_preserved(string printed, string? expected)
        => Assert.Equal(expected, ImportPrintedEffort.Unusable(printed));

    [Fact]
    public void Review_disappears_after_the_lifter_supplies_a_target()
    {
        var source = ImportPrintedEffort.Preserve(new AiSet(10, 12, 9, 90, null, null, "Partial reps"), "1-9");
        Assert.StartsWith("Partial reps", source.Notes);
        var set = new DraftSet(10, 12, null, 90, null, null, source.Notes);
        Assert.True(ImportPrintedEffort.NeedsReview(set));
        Assert.False(ImportPrintedEffort.NeedsReview(set with { TargetRpe = 9 }));
        Assert.False(ImportPrintedEffort.NeedsReview(set with { Rir = "1" }));
        Assert.False(ImportPrintedEffort.NeedsReview(set with { Warmup = true }));
    }

    [Fact]
    public void An_unusable_last_set_cell_does_not_remove_valid_early_set_effort()
    {
        const string source = """
            === PAGE 1 ===
            Exercise | Working Sets | Reps | Early Set RPE | Last Set RPE | Rest
            Bench Press | 3 | 8-10 | 8 | 1-9 | 90 sec
            """;
        var read = new AiProgram("Program", [new AiDay(null, null, 1, 1, "Upper", false, null,
            [new AiExercise("Bench Press", null, null, [new AiSet(8, 10, 9, 90, null, null, null)], SourcePage: 1)], 1)]);
        var sets = ImportTableEvidence.Enrich(read, source).Days!.Single().Exercises.Single().Sets;
        Assert.Equal(3, sets.Count);
        Assert.All(sets.Take(2), set => Assert.Equal(8, set.TargetRpe));
        Assert.Null(sets[2].TargetRpe);
        Assert.Contains("1-9", sets[2].Notes);
    }

    [Theory]
    [InlineData("75% 3", "3")]
    [InlineData("65% 4-5", "4-5")]
    public void Merged_percentage_and_low_effort_keep_both_printed_values(string cell, string effort)
    {
        var source = $"""
            === PAGE 63 ===
            Exercise | Warm-up Sets | Working Sets | Reps | %1RM RPE | Rest
            Reset Deadlift | 4 | 2 | 3 | {cell} | 3-5 min
            """;
        var read = new AiProgram("Program", [new AiDay(null, null, 9, 1, "Full Body 1", false, null,
            [new AiExercise("Reset Deadlift", null, null, [new AiSet(3, 3, 9, 240, null, null, null)], SourcePage: 63)], 63)]);
        var sets = ImportTableEvidence.Enrich(read, source).Days!.Single().Exercises.Single().Sets;
        Assert.All(sets, set =>
        {
            Assert.Equal(cell.Split(' ')[0], set.LoadText);
            Assert.Contains($"Printed RPE requires review: {effort}.", set.Notes);
            Assert.Null(set.TargetRpe);
            Assert.Null(set.Rir);
        });
    }

    // Essentials 3x/week, PDF p.34, Machine Crunch actually prints RPE 1-9.
    [Theory]
    [InlineData(null)]
    [InlineData(9d)]
    public async Task Unusable_printed_effort_is_preserved_for_review_without_failing_the_read(double? guessed)
    {
        const string source = """
            === PAGE 34 ===
            DAY LABEL: Lower
            Exercise | Warm-up Sets | Working Sets | Reps | RPE | Rest | Notes
            A1: Leg Press Toe Press | 1 | 2 | 15-20 | 10 | 0 min | Stretch your calves.
            A2: Machine Crunch | 1 | 2 | 10-12 | 1-9 | 1.5 min | Squeeze your abs.
            """;
        var read = new AiProgram("Essentials", [new AiDay(null, null, 5, 1, "Lower", false, null,
            [new AiExercise("Machine Crunch", null, null,
                [new AiSet(10, 12, guessed, 90, null, null, null)], SourcePage: 34)], 34)]);
        var repaired = ImportTableEvidence.Enrich(read, source);
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var draft = await harness.Imports(StubHandler.Program("{}")).ToDraft(repaired, default);
        var exercise = draft.Workouts.Single().Exercises.Single(e => e.SourceName == "Machine Crunch");
        Assert.All(exercise.Sets.Where(s => !s.Warmup), set =>
        {
            Assert.Null(set.TargetRpe);
            Assert.Null(set.Rir);
            Assert.Contains("1-9", set.Notes);
        });
        var issues = ImportValidation.ReviewIssues(draft);
        var issue = Assert.Single(issues, i => i.Code == "effort_instruction_conflict");
        Assert.Equal(34, issue.SourcePage);
        Assert.Equal(exercise.LineId, issue.ExerciseLineId);
        Assert.DoesNotContain(issues, i => i.Code == "rpe_unread");
        Assert.False(ImportReviewPolicy.StopsRead(issue));
        Assert.Equal(Json.Write(repaired), Json.Write(ImportTableEvidence.Enrich(repaired, source)));
    }
}
