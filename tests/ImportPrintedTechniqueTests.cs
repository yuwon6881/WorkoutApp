using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportPrintedTechniqueTests
{
    // Min-Max Phase 2 5x/week, PDF p.34: the intensity-technique column explicitly prints '-'.
    [Theory]
    [InlineData("-", "Dropset", null)]
    [InlineData("-", "Myo-reps", null)]
    [InlineData("-", "Partial reps", null)]
    [InlineData("-", "Failure", null)]
    [InlineData("-", "AMRAP", null)]
    [InlineData("-", "Dropset (reduce weight by 50%)", null)]
    [InlineData("Failure", "Myo-reps: 3 mini-sets", "Failure")]
    [InlineData("Long-length Partials (on all reps of the last set)", "Long-length Partials (on all reps of the last set)", "Long-length Partials (on all reps of the last set)")]
    [InlineData("Failure", "Dropset", "Failure")]
    [InlineData("Lengthened partials", "Myo-reps", "Lengthened partials")]
    public void Printed_technique_column_overrides_conflicting_model_tags(string printed, string guessed, string? final)
    {
        var source = $"""
            === PAGE 34 ===
            DAY LABEL: Pull
            Exercise | Last-Set Intensity Technique | Warm-up Sets | Working Sets | Reps | RIR (Set 1) | RIR (Set 2) | RIR (Set 3) | Rest | Notes
            Pull-Up (Wide Grip) | {printed} | 1-2 | 3 | 4-6 | 0 | 1 | 1 | 2-3 min | Slow 2-3 second negative.
            """;
        var read = new AiProgram("Min-Max", [new AiDay(null, null, 2, 1, "Pull", false, null,
            [new AiExercise("Pull-Up (Wide Grip)", null, null,
                Enumerable.Range(0, 3).Select(_ => new AiSet(4, 6, 9, 150, null, null, guessed)).ToList(), SourcePage: 34)], 34)]);
        var result = ImportTableEvidence.Enrich(read, source);
        var exercise = result.Days!.Single().Exercises.Single();
        Assert.All(exercise.Sets.Take(2), set => Assert.Null(set.Notes));
        Assert.Equal(final, exercise.Sets[^1].Notes);
        Assert.Equal(Json.Write(result), Json.Write(ImportTableEvidence.Enrich(result, source)));
    }

    [Fact]
    public void Coaching_text_and_source_prescribed_partials_survive_a_blank_technique_marker()
    {
        const string source = """
            === PAGE 1 ===
            Exercise | Last-Set Intensity Technique | Sets | Reps | RPE | Rest | Notes
            Cable Flye | - | 3 | 10-12 | 9 | 90 sec | Do lengthened partials on all working sets.
            """;
        var read = Program("Dropset — Use straps");
        var sets = ImportTableEvidence.Enrich(read, source).Days!.Single().Exercises.Single().Sets;
        Assert.All(sets, set =>
        {
            Assert.Contains("Use straps", set.Notes);
            Assert.Contains("Lengthened partials", set.Notes);
            Assert.DoesNotContain("Dropset", set.Notes);
        });
    }

    [Theory]
    [InlineData("Exercise | Sets | Reps | RPE | Rest", "Cable Flye | 3 | 10-12 | 9 | 90 sec")]
    [InlineData("Exercise | Last-Set Intensity Technique | Sets | Reps | RPE | Rest", "Cable Flye | | 3 | 10-12 | 9 | 90 sec")]
    public void A_missing_technique_statement_does_not_disprove_instructions_from_elsewhere(string header, string row)
    {
        var source = $"=== PAGE 1 ===\n{header}\n{row}";
        var sets = ImportTableEvidence.Enrich(Program("Dropset"), source).Days!.Single().Exercises.Single().Sets;
        Assert.All(sets, set => Assert.Equal("Dropset", set.Notes));
    }

    private static AiProgram Program(string notes) => new("Program", [new AiDay(null, null, 1, 1, "Day 1", false, null,
        [new AiExercise("Cable Flye", null, null,
            Enumerable.Range(0, 3).Select(_ => new AiSet(10, 12, 9, 90, null, null, notes)).ToList(), SourcePage: 1)], 1)]);
}
