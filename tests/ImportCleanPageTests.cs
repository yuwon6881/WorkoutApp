using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Where the reader rebuilt a clean table, its printed rows decide the day's exercises and values.
/// Each read below makes a mistake real reads have made on pages that print the answer plainly.
public sealed class ImportCleanPageTests
{
    private const string Page = """
        === PAGE 20 ===
        DAY LABEL: Day 3
        Exercise | Working Sets | Reps | RPE | Rest | Substitution Option 1 | Substitution Option 2
        A1. Dumbbell bench-braced wrist curl | 3 | 12-15 | 9 | 1 min | Cable Wrist Curl | N/A
        A2. Reverse Barbell Curl | 3 | 10-12 | 9 | 1 min | EZ-Bar Reverse Curl | Cable Reverse Curl
        Farmer's Walk | 2 | 30 sec | 8 | 2 min | Trap Bar Carry | N/A
        """;

    private static AiSet Set(int min, int max, double? rpe, int? rest, string? restText)
        => new(min, max, rpe, rest, null, null, null, $"{min}-{max}", restText, SourcePage: 20);

    private static AiDay Day(string name, List<AiExercise> exercises) => new(null, null, 4, 4, name, false, null, exercises, 20);

    [Fact]
    public void A_drifted_read_of_a_clean_page_becomes_the_printed_rows()
    {
        var drifted = Day("Day 3", [
            new AiExercise("Dumbbell Bench-Braced Wrist Curl", null, null, [Set(12, 15, 9, 90, "90 sec")], SourcePage: 20),
            new AiExercise("Reverse Barbell Curl", null, null, [Set(10, 12, 9, 60, "1 min")], SourcePage: 20),
            new AiExercise("", null, null, [], SourcePage: 20)
        ]);

        var exercises = Assert.Single(ImportTableEvidence.Enrich(new AiProgram("Forearm", [drifted]), Page).Days!).Exercises;

        Assert.Equal(["Dumbbell bench-braced wrist curl", "Reverse Barbell Curl", "Farmer's Walk"], exercises.Select(exercise => exercise.SourceName));
        Assert.Equal([3, 3, 2], exercises.Select(exercise => exercise.Sets.Count));
        Assert.All(exercises[0].Sets, set => Assert.Equal((60, "1 min", "extracted"), (set.RestSeconds, set.RestText, set.RestSource)));
        Assert.All(exercises[2].Sets, set => Assert.Equal((8d, 120), (set.TargetRpe, set.RestSeconds)));
        Assert.Equal(["A1", "A2", null], exercises.Select(exercise => exercise.SequenceGroup));
        Assert.Equal(["Cable Wrist Curl"], exercises[0].Substitutions);
        Assert.Equal(["EZ-Bar Reverse Curl", "Cable Reverse Curl"], exercises[1].Substitutions);
    }

    [Fact]
    public void Recovering_the_rows_twice_gives_the_same_day()
    {
        var read = new AiProgram("Forearm", [Day("Day 3", [
            new AiExercise("Reverse Barbell Curl", null, null, [Set(10, 12, 9, 90, "90 sec")], SourcePage: 20)])]);

        var once = ImportTableEvidence.Enrich(read, Page);
        var twice = ImportTableEvidence.Enrich(once, Page);

        Assert.Equal(Json.Write(once), Json.Write(twice));
    }

    [Fact]
    public void A_page_with_a_row_missing_its_set_count_keeps_the_read()
    {
        const string dirty = """
            === PAGE 20 ===
            Exercise | Working Sets | Reps | RPE | Rest
            Reverse Barbell Curl | 3 | 10-12 | 9 | 1 min
            Farmer's Walk |  | 30 sec | 8 | 2 min
            """;
        var read = Day("Day 3", [new AiExercise("Reverse Barbell Curl", null, null, [Set(10, 12, 9, 60, "1 min")], SourcePage: 20)]);

        var exercises = Assert.Single(ImportTableEvidence.Enrich(new AiProgram("Forearm", [read]), dirty).Days!).Exercises;

        Assert.Equal(["Reverse Barbell Curl"], exercises.Select(exercise => exercise.SourceName));
        Assert.Equal(3, exercises[0].Sets.Count);
    }

    [Fact]
    public void A_page_printing_two_days_gives_each_day_the_rows_under_its_label()
    {
        const string twoDays = """
            === PAGE 20 ===
            DAY LABEL: Day 1
            Exercise | Working Sets | Reps | RPE | Rest
            Wrist Curl | 3 | 12-15 | 9 | 1 min
            Reverse Curl | 2 | 10-12 | 9 | 1 min
            DAY LABEL: Day 2
            Exercise | Working Sets | Reps | RPE | Rest
            Wrist Curl | 2 | 15-20 | 8 | 1 min
            Plate Pinch | 3 | 30 sec | 9 | 90 sec
            """;
        var read = new AiProgram("Forearm", [
            Day("Day 1", [new AiExercise("Wrist Curl", null, null, [Set(12, 15, 9, 60, "1 min")], SourcePage: 20)]),
            Day("Day 2", [new AiExercise("Wrist Curl", null, null, [Set(15, 20, 8, 60, "1 min")], SourcePage: 20)])
        ]);

        var days = ImportTableEvidence.Enrich(read, twoDays).Days!;

        Assert.Equal(["Wrist Curl", "Reverse Curl"], days[0].Exercises.Select(exercise => exercise.SourceName));
        Assert.Equal(["Wrist Curl", "Plate Pinch"], days[1].Exercises.Select(exercise => exercise.SourceName));
        Assert.Equal([3, 2], days[0].Exercises.Select(exercise => exercise.Sets.Count));
        Assert.Equal([2, 3], days[1].Exercises.Select(exercise => exercise.Sets.Count));
        Assert.Equal(15, days[1].Exercises[0].Sets[0].RepMin);
    }

    [Fact]
    public void The_reads_catalog_id_notes_and_substitutions_survive_the_printed_rows()
    {
        var read = Day("Day 3", [
            new AiExercise("Reverse Barbell Curl", "reverse-curl", "Keep elbows pinned", [Set(10, 12, 9, 60, "1 min")],
                SequenceGroup: "B1", Substitutions: ["Hammer Curl"], CoachingNotes: "Slow eccentric", SourcePage: 20)
        ]);

        var exercise = Assert.Single(ImportTableEvidence.Enrich(new AiProgram("Forearm", [read]), Page).Days!).Exercises[1];

        Assert.Equal(("reverse-curl", "Keep elbows pinned", "B1", "Slow eccentric"),
            (exercise.ExerciseId, exercise.Notes, exercise.SequenceGroup, exercise.CoachingNotes));
        Assert.Equal(["Hammer Curl"], exercise.Substitutions);
    }

    [Fact]
    public void A_read_that_names_none_of_the_printed_rows_is_not_paired_with_them()
    {
        var read = Day("Day 3", [
            new AiExercise("Cable Crunch", null, null, [Set(10, 12, 9, 60, "1 min")], SourcePage: 20),
            new AiExercise("Hanging Leg Raise", null, null, [Set(10, 12, 9, 60, "1 min")], SourcePage: 20)
        ]);

        var exercises = Assert.Single(ImportTableEvidence.Enrich(new AiProgram("Forearm", [read]), Page).Days!).Exercises;

        Assert.Equal(["Cable Crunch", "Hanging Leg Raise"], exercises.Select(exercise => exercise.SourceName));
    }

    [Fact]
    public void The_review_counts_the_days_taken_from_printed_tables()
    {
        var draft = new List<DraftWorkout>
        {
            new(Guid.NewGuid(), 4, "Day 3", null, null, [], SourcePage: 20),
            new(Guid.NewGuid(), 4, "Rest Day", null, null, [], IsRestDay: true, SourcePage: 20)
        };

        var notice = ImportTableEvidence.PrintedRowsNotice(draft, Page);

        Assert.Equal(("printed_rows_used", "info"), (notice!.Code, notice.Severity));
        Assert.Contains("1 day was read", notice.Message);
    }

    /// Ultimate PPL 4x p.37: a read that kept one of three printed rows, and a page whose footer rest was already read.
    [Fact]
    public void Printed_table_rows_restore_omitted_movements_and_targets()
    {
        var program = new AiProgram("wrong", [new AiDay(null, null, 1, 1, "Pull #1", false, null,
            [new AiExercise("Lat Pulldown (Failure Set)", null, null,
                [new AiSet(1, 1, null, null, null, null, null, RpeSource: "inferred")], SourcePage: 37)], 37)]);
        const string source = """
            === PAGE 37 ===
            DAY LABEL: pull #1
            Exercise | Warm-up Sets | WORKING SETS | Reps | Load | RPE | Rest | NOTES
            Lat Pulldown (Feeder Sets) | 0 | 4 | 10 | | See Notes | ~2-3 min | Four feeder sets
            Lat Pulldown (Failure Set) | 0 | 1 | 10+5 | | 10 | ~2-3 min | Dropset
            Omni-Grip Machine Chest-Supported Row | 2 | 3 | 10-12 | | 8-9 | ~2-3 min | Three grips
            Mandatory 1-2 Rest Days
            """;

        var enriched = ImportTableEvidence.Enrich(program, source);
        var day = enriched.Days![0];
        Assert.Equal(3, day.Exercises.Count);
        Assert.Equal([4, 1, 3], day.Exercises.Select(exercise => exercise.Sets.Count));
        Assert.Equal(["0", "0", "2"], day.Exercises.Select(exercise => exercise.WarmupSets));
        Assert.All(day.Exercises[0].Sets, set => Assert.Null(set.TargetRpe));
        Assert.All(day.Exercises[0].Sets, set => Assert.Equal("extracted", set.RpeSource));
        Assert.Equal(10, day.Exercises[1].Sets[0].TargetRpe);
        Assert.All(day.Exercises[2].Sets, set => Assert.Equal(9, set.TargetRpe));
        Assert.All(day.Exercises.SelectMany(exercise => exercise.Sets), set => Assert.Equal(150, set.RestSeconds));
        Assert.Equal(2, enriched.Days.Count);
    }

    [Fact]
    public void An_already_read_footer_rest_is_not_turned_into_a_second_training_table()
    {
        var program = new AiProgram("sample", [
            new AiDay(null, null, 1, 1, "Pull #1", false, null,
                [new AiExercise("Squat", null, null, [new AiSet(8, 10, 9, 150, null, null, null)],
                    SourcePage: 37)], 37),
            new AiDay(null, null, 1, 1, "Rest Day", true, null, [], 37)
        ]);
        const string source = """
            === PAGE 37 ===
            DAY LABEL: pull #1
            Exercise | Warm-up Sets | WORKING SETS | Reps | Load | RPE | Rest
            Squat | 1 | 2 | 8-10 | | 8-9 | ~2-3 min
            Mandatory 1-2 Rest Days
            """;

        var enriched = ImportTableEvidence.Enrich(program, source);
        Assert.Equal(2, enriched.Days!.Count);
        Assert.Single(enriched.Days, day => !day.IsRestDay);
        Assert.Single(enriched.Days, day => day.IsRestDay);
    }

    /// Pure Bodybuilding Full Body p.8 prints "Superset A1: Assisted Pull-Up". The model returns
    /// "Assisted Pull-Up" in group A1 with no effort, and a rest day from the same page's band; the
    /// four superset rows must still be paired, or 14 working sets are left without their RPE.
    [Fact]
    public void A_superset_word_before_the_tag_does_not_keep_a_row_from_its_movement()
    {
        const string text = """
            === PAGE 8 ===
            DAY LABEL: Full Body #3
            Exercise | Last-Set Intensity Technique | Warm-up Sets | WORKING SETS | Reps | Early Set RPE | Last Set RPE | Rest
            Superset A1: Assisted Pull-Up | N/A | 1-2 | 4 | 8-10 | ~7-8 | ~8-9 | ~1 min
            Superset A2: Paused Assisted Dip | N/A | 1-2 | 4 | 8-10 | ~7-8 | ~8-9 | ~1 min
            Cable Paused Shrug-In | N/A | 1 | 3 | 10-12 | ~7-8 | ~8-9 | ~0.5-1 min
            1-2 Rest Days
            """;
        AiExercise Read(string name, string? group, int sets) => new(name, null, null,
            Enumerable.Range(0, sets).Select(_ => new AiSet(8, 10, null, null, null, null, null, SourcePage: 8)).ToList(), SequenceGroup: group, SourcePage: 8);
        var program = new AiProgram("Full Body", [
            new AiDay(null, null, 1, 1, "Full Body #3", false, null, [Read("Assisted Pull-Up", "A1", 4), Read("Paused Assisted Dip", "A2", 4), Read("Cable Paused Shrug-In", null, 3)], 8),
            new AiDay(null, null, 1, 1, "Rest Day", true, null, [], 8)]);

        var exercises = ImportTableEvidence.Enrich(program, text).Days![0].Exercises;

        Assert.Equal(["Assisted Pull-Up", "Paused Assisted Dip", "Cable Paused Shrug-In"], exercises.Select(exercise => exercise.SourceName));
        Assert.Equal(["A1", "A2", null], exercises.Select(exercise => exercise.SequenceGroup));
        Assert.All(exercises.SelectMany(exercise => exercise.Sets), set => Assert.NotNull(set.TargetRpe));
    }
}
