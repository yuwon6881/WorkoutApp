using System.Globalization;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportTableEvidenceTests
{
    [Fact]
    public void Coordinate_columns_restore_both_rir_values_and_working_set_count()
    {
        var program = new AiProgram("Min-Max", [new AiDay("Block 1", "Base", 1, 1, "Lower 1", false, null, [
            new AiExercise("Squat", null, null, [
                new AiSet(6, 8, null, null, null, null, null, RpeSource: "inferred")], SourcePage: 26)
        ], 26)]);
        const string text = """
            === PAGE 26 ===
            Squat | This is a wrapped note
            N/A | 2-4 | 2 | 6-8 | 3 | 2 | 3-5 min | See Notes | See Notes
            """;

        var enriched = ImportTableEvidence.Enrich(program, text);
        var exercise = Assert.Single(Assert.Single(enriched.Days!).Exercises);

        Assert.Equal("2", exercise.WorkingSets);
        Assert.Equal(2, exercise.Sets.Count);
        Assert.Equal([7d, 8d], exercise.Sets.Select(set => set.TargetRpe));
        Assert.All(exercise.Sets, set => Assert.Equal("inferred", set.RpeSource));
        Assert.Equal(["3", "2"], exercise.Sets.Select(set => set.Rir));
        Assert.Equal(240, exercise.Sets[0].RestSeconds);
        Assert.Equal("3-5 min", exercise.Sets[0].RestText);
    }

    [Fact]
    public void Missing_day_page_uses_a_unique_exercise_source_page()
    {
        var program = new AiProgram("Min-Max", [new AiDay("Block 1", "Base", 1, 1, "Lower 1", false, null, [
            new AiExercise("Squat", null, null, [
                new AiSet(6, 8, null, null, null, null, null, RpeSource: "inferred")], SourcePage: 26)
        ])]);
        const string text = """
            === PAGE 26 ===
            Squat | This is a wrapped note
            N/A | 2-4 | 2 | 6-8 | 3 | 2 | 3-5 min | See Notes | See Notes
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.Equal("2", exercise.WorkingSets);
        Assert.Equal([7d, 8d], exercise.Sets.Select(set => set.TargetRpe));
        Assert.Equal(["3", "2"], exercise.Sets.Select(set => set.Rir));
    }

    [Fact]
    public void Conflicting_exercise_source_pages_do_not_reconcile_the_day()
    {
        var program = new AiProgram("Min-Max", [new AiDay("Block 1", "Base", 1, 1, "Lower 1", false, null, [
            new AiExercise("Squat", null, null, [new AiSet(6, 8, null, null, null, null, null)], SourcePage: 26),
            new AiExercise("Deadlift", null, null, [new AiSet(6, 8, null, null, null, null, null)], SourcePage: 27)
        ])]);
        const string text = """
            === PAGE 26 ===
            2 x 6-8 | 2 | 6-8 | 3 | 2 | 3-5 min
            === PAGE 27 ===
            3 x 6-8 | 2 | 6-8 | 3 | 2 | 3-5 min
            """;

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        Assert.All(exercises, exercise => Assert.Null(exercise.WorkingSets));
        Assert.All(exercises, exercise => Assert.Single(exercise.Sets));
    }

    [Fact]
    public void One_set_na_rir_is_kept_as_one_working_set_without_inventing_the_second_value()
    {
        var program = new AiProgram("Min-Max", [new AiDay("Block 1", "Base", 1, 1, "Lower 1", false, null, [
            new AiExercise("Smith Machine Lunge", null, null, [
                new AiSet(6, 8, null, null, null, null, null, RpeSource: "inferred")], SourcePage: 26)
        ], 26)]);
        const string text = """
            === PAGE 26 ===
            N/A | 2-4 | 1 | 6-8 | 1 | N/A | 2-4 min | DB Lunge | Barbell Lunge
            """;

        var enriched = ImportTableEvidence.Enrich(program, text);
        var set = Assert.Single(Assert.Single(enriched.Days!).Exercises).Sets.Single();

        Assert.Equal(9, set.TargetRpe);
        Assert.Equal("1", set.Rir);
        Assert.Equal(180, set.RestSeconds);
        Assert.Single(Assert.Single(enriched.Days!).Exercises.Single().Sets);
    }

    [Fact]
    public void Explicit_second_set_na_rir_does_not_inherit_first_set_rir_or_derived_rpe()
    {
        var program = new AiProgram("Min-Max", [new AiDay("Block 1", "Base", 1, 1, "Lower 1", false, null, [
            new AiExercise("Squat", null, null, [
                new AiSet(6, 8, 9, null, null, null, null, Rir: "1", RpeSource: "inferred")
            ], SourcePage: 26)
        ], 26)]);
        const string text = """
            === PAGE 26 ===
            Squat | Wrapped note
            N/A | 2-4 | 2 | 6-8 | 1 | N/A | 2-4 min | See Notes | See Notes
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.Equal("2", exercise.WorkingSets);
        Assert.Equal(2, exercise.Sets.Count);
        Assert.Equal("1", exercise.Sets[0].Rir);
        Assert.Equal(9, exercise.Sets[0].TargetRpe);
        Assert.Equal("N/A", exercise.Sets[1].Rir);
        Assert.Null(exercise.Sets[1].TargetRpe);
    }

    [Fact]
    public void Source_working_set_count_overrides_conflicting_model_count_and_trims_excess_rows()
    {
        var program = new AiProgram("Count", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Squat", null, null, [
                new AiSet(6, 8, 7, 90, null, null, "First", SourcePage: 42),
                new AiSet(8, 10, 8, 90, null, null, "Second", SourcePage: 42),
                new AiSet(12, 15, 9, 120, null, null, "Extra third row", SourcePage: 42)
            ], SourcePage: 42, WorkingSets: "3")
        ], 42)]);
        const string text = """
            === PAGE 42 ===
            Exercise | Working Sets | Reps | RPE | Rest
            Squat | 2 | 6-8 | 7 | 90 sec
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.Equal("2", exercise.WorkingSets);
        Assert.Equal(2, exercise.Sets.Count);
        Assert.Equal(["First", "Second"], exercise.Sets.Select(set => set.Notes));
    }

    [Fact]
    public void Page_headings_and_rest_footer_are_reconciled_without_making_a_training_table_an_extra_day()
    {
        var program = new AiProgram("Min-Max", [
            new AiDay(null, null, 0, 0, "", false, null, [], 55),
            new AiDay(null, null, 0, 0, "", false, null, [
                new AiExercise("Squat", null, null, [new AiSet(6, 8, null, null, null, null, null)], SourcePage: 56)
            ], 56),
            new AiDay(null, null, 7, 1, "Rest Day", true, null, [], 57)
        ]);
        const string text = """
            === PAGE 55 ===
            BLOCK 2
            Deload Week
            WEEK 7
            Upper 1
            N/A | 2-4 | 1 | 6-8 | 2 | 1 | 3-5 min
            === PAGE 56 ===
            WEEK 7
            Lower 1
            N/A | 2-4 | 1 | 6-8 | 3 | 2 | 3-5 min
            Rest Day
            === PAGE 57 ===
            WEEK 7
            Rest Day
            """;

        var enriched = ImportTableEvidence.Enrich(program, text);

        Assert.Equal(("Block 2", "Deload Week", "Upper 1", 7),
            (enriched.Days![0].Block, enriched.Days[0].Phase, enriched.Days[0].DayName, enriched.Days[0].WeekNumber));
        Assert.False(enriched.Days[1].IsRestDay);
        Assert.True(enriched.Days[2].IsRestDay);
    }

    [Fact]
    public void N_a_rep_range_still_recovers_working_sets_and_rir()
    {
        var program = new AiProgram("Min-Max", [new AiDay("Block 1", "Base", 1, 1, "Arms/Delts", false, null, [
            new AiExercise("Dead Hang", null, null, [new AiSet(1, 1, null, null, null, null, null)], SourcePage: 84)
        ], 84)]);
        const string text = """
            === PAGE 84 ===
            Dead Hang | N/A | 0-1 | 2 | N/A | 0 | 0 | 1-2 min | N/A | N/A
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.Equal(2, exercise.Sets.Count);
        Assert.All(exercise.Sets, set => Assert.Equal(10, set.TargetRpe));
        Assert.All(exercise.Sets, set => Assert.Equal("0", set.Rir));
        Assert.All(exercise.Sets, set => Assert.Equal(90, set.RestSeconds));
    }

    [Fact]
    public void Header_aligned_newer_table_recovers_count_reps_percentage_dual_rpe_and_rest_range()
    {
        var program = new AiProgram("Newer", [new AiDay("Block 1", "Base", 1, 1, "Push", false, null, [
            new AiExercise("Barbell Bench Press", null, null, [
                new AiSet(0, 0, null, null, null, null, null, SourcePage: 12)
            ], SourcePage: 12)
        ], 12)]);
        const string text = """
            === PAGE 12 ===
            Exercise | Warm-up Sets | Working Sets | Reps | Early Set RPE | Last Set RPE | Last-Set Intensity Technique | Load | Rest (min) | Tracking Load
            Barbell Bench Press | 2 | 3 | 6-8 | 7 | 9 | Drop set | 75% 1RM | 2-3 |
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.Equal("3", exercise.WorkingSets);
        Assert.Equal(3, exercise.Sets.Count);
        Assert.All(exercise.Sets, set => Assert.Equal((6, 8, "6-8", "75% 1RM", 150),
            (set.RepMin, set.RepMax, set.RepsText, set.LoadText, set.RestSeconds)));
        Assert.Equal([7d, 7d, 9d], exercise.Sets.Select(set => set.TargetRpe));
        Assert.All(exercise.Sets, set => Assert.Equal("extracted", set.RpeSource));
        Assert.All(exercise.Sets, set => Assert.Equal("2-3 min", set.RestText));
    }

    [Fact]
    public void Legacy_combined_rpe_percent_load_and_compound_reps_are_recovered()
    {
        var program = new AiProgram("Legacy", [new AiDay(null, null, 1, 1, "Pull", false, null, [
            new AiExercise("Cable Lateral Raise", null, null, [
                new AiSet(1, 1, null, null, null, null, null, SourcePage: 18)
            ], SourcePage: 18)
        ], 18)]);
        const string text = """
            === PAGE 18 ===
            Exercise | Sets | Reps/Duration | RPE/%1RM | Rest (sec)
            Cable Lateral Raise | 3 | 12/12 | 8 / 70-75% 1RM | 60-90
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.Equal("3", exercise.WorkingSets);
        Assert.All(exercise.Sets, set =>
        {
            Assert.Equal("12/12", set.RepsText);
            Assert.Equal(1, set.RepMin);
            Assert.Equal(1, set.RepMax);
            Assert.Equal(8, set.TargetRpe);
            Assert.Equal("70-75% 1RM", set.LoadText);
            Assert.Equal("60-90 sec", set.RestText);
            Assert.Equal(75, set.RestSeconds);
        });
    }

    [Theory]
    [InlineData("%1RM", "80", "80% 1RM", null)]
    [InlineData("%1RM", "8", "8% 1RM", null)]
    [InlineData("%1RM", "75-85", "75-85% 1RM", null)]
    [InlineData("RPE/%1RM", "8/80", "80% 1RM", 8d)]
    [InlineData("RPE/%1RM", "8", null, 8d)]
    public void Percent_load_headers_preserve_implicit_percent_without_misreading_combined_rpe(
        string header, string value, string? expectedLoad, double? expectedRpe)
    {
        var program = new AiProgram("Percent load", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Machine Row", null, null, [new AiSet(6, 8, null, null, null, null, null, SourcePage: 19)], SourcePage: 19)
        ], 19)]);
        var text = $"""
            === PAGE 19 ===
            Exercise | Working Sets | Reps | {header} | Rest (min)
            Machine Row | 1 | 6-8 | {value} | 2
            """;

        var set = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises).Sets.Single();

        Assert.Equal(expectedLoad, set.LoadText);
        Assert.Equal(expectedRpe, set.TargetRpe);
        Assert.Equal("2 min", set.RestText);
        Assert.Equal(120, set.RestSeconds);
    }

    [Theory]
    [InlineData("APE", "8")]
    [InlineData("LSRPE", "9")]
    public void Rpe_aliases_recover_explicit_values(string heading, string value)
    {
        var program = new AiProgram("Aliases", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Machine Row", null, null, [new AiSet(8, 10, null, null, null, null, null, SourcePage: 21)], SourcePage: 21)
        ], 21)]);
        var text = $"""
            === PAGE 21 ===
            Exercise | Working Sets | Reps | {heading} | Rest
            Machine Row | 1 | 8-10 | {value} | 90 sec
            """;

        var set = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises).Sets.Single();

        Assert.Equal(double.Parse(value, CultureInfo.InvariantCulture), set.TargetRpe);
        Assert.Equal("90 sec", set.RestText);
        Assert.Equal(90, set.RestSeconds);
    }

    [Fact]
    public void Multiple_days_on_one_page_match_named_rows_instead_of_reusing_page_order()
    {
        var program = new AiProgram("Two tables", [
            new AiDay(null, null, 1, 1, "Upper", false, null, [
                new AiExercise("Leg Curl", null, null, [new AiSet(1, 1, null, null, null, null, null, SourcePage: 33)], SourcePage: 33)
            ], 33),
            new AiDay(null, null, 1, 1, "Lower", false, null, [
                new AiExercise("Machine Row", null, null, [new AiSet(1, 1, null, null, null, null, null, SourcePage: 33)], SourcePage: 33)
            ], 33)
        ]);
        const string text = """
            === PAGE 33 ===
            Exercise | Sets | Reps | RPE | Rest
            Machine Row | 4 | 6-8 | 8 | 120 sec
            Exercise | Sets | Reps | RPE | Rest
            Leg Curl | 2 | 12-15 | 9 | 60 sec
            """;

        var days = ImportTableEvidence.Enrich(program, text).Days!;

        Assert.Equal(("2", 12, 15, 9d, 60),
            (days[0].Exercises[0].WorkingSets, days[0].Exercises[0].Sets[0].RepMin, days[0].Exercises[0].Sets[0].RepMax,
                days[0].Exercises[0].Sets[0].TargetRpe, days[0].Exercises[0].Sets[0].RestSeconds));
        Assert.Equal(("4", 6, 8, 8d, 120),
            (days[1].Exercises[0].WorkingSets, days[1].Exercises[0].Sets[0].RepMin, days[1].Exercises[0].Sets[0].RepMax,
                days[1].Exercises[0].Sets[0].TargetRpe, days[1].Exercises[0].Sets[0].RestSeconds));
    }

    [Fact]
    public void Exact_source_row_preserves_valid_model_values_and_unmatched_rows_are_not_applied_positionally()
    {
        var program = new AiProgram("Preserve", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Different Movement", null, null, [
                new AiSet(5, 7, 8, 45, null, "40 kg", "model note", "5-7", "45 sec", "2", SourcePage: 40)
            ], SourcePage: 40)
        ], 40)]);
        const string text = """
            === PAGE 40 ===
            Exercise | Working Sets | Reps | RPE | Load | Rest
            Barbell Squat | 4 | 8-10 | 9 | 80% 1RM | 2 min
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);
        var set = Assert.Single(exercise.Sets);

        Assert.Null(exercise.WorkingSets);
        Assert.Equal((5, 7, "5-7", 8, "40 kg", "45 sec", 45, "2"),
            (set.RepMin, set.RepMax, set.RepsText, set.TargetRpe, set.LoadText, set.RestText, set.RestSeconds, set.Rir));
    }

    [Theory]
    [InlineData("Suggested Rest Day")]
    [InlineData("Mandatory Rest Day")]
    public void Rest_day_footer_variants_are_recognized(string label)
    {
        var program = new AiProgram("Rest", [new AiDay(null, null, 1, 1, "", false, null, [], 41)]);
        var text = $"=== PAGE 41 ===\n{label}";

        Assert.True(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).IsRestDay);
    }
}
