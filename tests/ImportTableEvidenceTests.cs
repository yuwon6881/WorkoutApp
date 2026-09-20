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
}
