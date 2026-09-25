using System.Globalization;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportTableEvidenceTests
{
    [Fact]
    public async Task Clean_multi_session_percent_RPE_table_keeps_its_printed_rest_values()
    {
        const string text = """
            JEFF NIPPARD’S - POWERBUILDING SYSTEM
            WEEK 1
            DAY LABEL: FULL BODY 1: SQUAT, OHP
            WORKOUT | EXERCISE | WARM-UP SETS | WORKING SETS | REPS | %1RM RPE | REST | SET 1 | SET 2 | SET 3 | SET 4 | NOTES
             | BACK SQUAT | 4 | 1 | 5 | 75-80% 7.5 | 3-4 MIN |  |  |  |  | FOCUS ON TECHNIQUE AND EXPLOSIVE POWER!
             | BACK SQUAT | 0 | 2 | 8 | 70% N/A | 3-4 MIN |  |  |  |  | KEEP BACK ANGLE AND FORM CONSISTENT ACROSS ALL REPS
             | OVERHEAD PRESS | 2 | 3 | 8 | 70% N/A | 2-3 MIN |  |  |  |  | RESET EACH REP (DON'T TOUCH-AND-PRESS)
             | GLUTE HAM RAISE | 1 | 3 | 8-10 | N/A 7 | 1-2 MIN |  |  |  |  | KEEP YOUR HIPS STRAIGHT, DO NORDIC HAM CURLS IF NO GHR MACHINE
             | HELMS ROW | 1 | 3 | 12-15 | N/A 9 | 1-2 MIN |  |  |  |  | STRICT FORM. DRIVE ELBOWS OUT AND BACK AT 45 DEGREE ANGLE
             | HAMMER CURL | 0 | 3 | 20-25 | N/A 10 | 1-2 MIN |  |  |  |  | KEEP ELBOWS LOCKED IN PLACE, SQUEEZE THE DUMBBELL HANDLE HARD!
            DAY LABEL: FULL BODY 2: DEADLIFT, BENCH PRESS
            WORKOUT | EXERCISE | WARM-UP SETS | WORKING SETS | REPS | %1RM RPE | REST | SET 1 | SET 2 | SET 3 | SET 4 | NOTES
             | DEADLIFT | 4 | 3 | 4 | 80% N/A | 3-5 MIN |  |  |  |  | CONVENTIONAL OR SUMO: USE WHATEVER STANCE YOU ARE STRONGER WITH
             | BARBELL BENCH PRESS | 4 | 1 | 3 | 82.5-87.5% 8.5 | 4-5 MIN |  |  |  |  | TOP SET. LEAVE 1 (MAYBE 2) REPS IN THE TANK. HARD SET.
             | BARBELL BENCH PRESS | 0 | 2 | 10 | 67.5% N/A | 2-3 MIN |  |  |  |  | QUICK 1 SECOND PAUSE ON THE CHEST ON EACH REP
             | HIP ABDUCTION | 0 | 3 | 15-20 | N/A 9 | 1-2 MIN |  |  |  |  | MACHINE, BAND OR WEIGHTED, 1 SECOND ISOMETRIC HOLD AT THE TOP OF EACH REP
             | WEIGHTED PULL-UP | 1 | 3 | 5-8 | N/A 8 | 3-4 MIN |  |  |  |  | 1.5X SHOULDER WIDTH GRIP, PULL YOUR CHEST TO THE BAR
             | STANDING CALF RAISE | 1 | 3 | 8-10 | N/A 9 | 2-3 MIN |  |  |  |  | 1-2 SECOND PAUSE AT THE BOTTOM OF EACH REP, FULL ROM
            SUGGESTED REST DAY
            DAY LABEL: FULL BODY 3: SQUAT, DIP
            WORKOUT | EXERCISE | WARM-UP SETS | WORKING SETS | REPS | %1RM RPE | REST | SET 1 | SET 2 | SET 3 | SET 4 | NOTES
             | BACK SQUAT | 4 | 3 | 4 | 80% N/A | 3-4 MIN |  |  |  |  | MAINTAIN TIGHT PRESSURE IN YOUR UPPER BACK AGAINST THE BAR
             | WEIGHTED DIP | 2 | 3 | 8 | N/A 8 | 2-3 MIN |  |  |  |  | DO DUMBBELL FLOOR PRESS IF NO ACCESS TO DIP HANDLES
             | HANGING LEG RAISE | 0 | 3 | 10-12 | N/A 9 | 1-2 MIN |  |  |  |  | KNEES TO CHEST, CONTROLLED REPS, STRAIGHTEN LEGS MORE TO INCREASE DIFFICULTY
             | LAT PULL-OVER | 1 | 3 | 12-15 | N/A 8 | 1-2 MIN |  |  |  |  | CAN USE A DB, CABLE/ROPE OR BAND, STRETCH AND SQUEEZE LATS!
             | INCLINE DUMBBELL CURL | 1 | 3 | 12-15 | N/A 9 | 1-2 MIN |  |  |  |  | DO EACH ARM ONE AT A TIME RATHER THAN ALTERNATING, START WITH YOUR WEAK ARM
             | FACE PULL | 0 | 4 | 15-20 | N/A 9 | 1-2 MIN |  |  |  |  | CAN USE CABLE/ROPE OR BAND, RETRACT YOUR SHOULDER BLADES AS YOU PULL
            """;
        var pages = new List<ImportPageText> { new(36, text) };
        var schedule = ImportPrintedSchedule.Read(pages);
        Assert.NotNull(schedule);
        var printed = ImportTableEvidence.ReadPrintedSection(schedule!.Days, $"=== PAGE 36 ===\n{text}");
        Assert.NotNull(printed);

        await using var harness = await Harness.Create();
        await harness.SignIn();
        var draft = await harness.Imports(StubHandler.Program("{}")).ToDraft(printed!, default);
        var workouts = draft.Workouts.Where(workout => !workout.IsRestDay).ToList();
        Assert.Equal(3, workouts.Count);
        Assert.Equal(18, workouts.Sum(workout => workout.Exercises.Count));
        Assert.All(workouts.SelectMany(workout => workout.Exercises).SelectMany(exercise => exercise.Sets), set =>
        {
            Assert.NotNull(set.RestSeconds);
            Assert.False(string.IsNullOrWhiteSpace(set.RestText));
        });
        Assert.DoesNotContain(ImportValidation.ReviewIssues(draft), issue => issue.Code == "rest_unread");
    }

    [Fact]
    public void Minute_typo_is_recovered_only_when_the_table_header_establishes_minutes()
    {
        var program = new AiProgram("Rest", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Hamstring Curl", null, null, [new AiSet(8, 10, 8, null, null, null, null)], SourcePage: 1)
        ], 1)]);
        const string text = """
            === PAGE 1 ===
            Exercise | Working Sets | Reps | Rest (min)
            Hamstring Curl | 2 | 8-10 | 1-2 MN
            """;

        var set = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises).Sets[0];

        Assert.Equal("1-2 MN", set.RestText);
        Assert.Equal(90, set.RestSeconds);
    }

    [Fact]
    public void A_matched_row_overrides_drifted_values_even_when_another_row_makes_the_page_unclean()
    {
        var program = new AiProgram("Source", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Squat", null, null, [new AiSet(8, 10, 9, 90, null, null, null,
                RestText: "90 sec", RestSource: "extracted")], SourcePage: 3),
            new AiExercise("Dead Hang", null, null, [new AiSet(1, 1, 8, 90, null, null, null,
                RestText: "90 sec", RestSource: "extracted")], SourcePage: 3)
        ], 3)]);
        const string text = """
            === PAGE 3 ===
            Exercise | Working Sets | Reps | RIR | Rest
            Squat | 1 | 8-10 | 1 | 1-2 min
            Dead Hang | 2 | N/A | 0 | 1-2 min
            """;

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        Assert.Equal("1-2 min", exercises[0].Sets[0].RestText);
        Assert.Equal(90, exercises[0].Sets[0].RestSeconds);
    }

    [Fact]
    public void Dropped_last_exercise_is_recovered_from_the_matching_day_table()
    {
        var program = new AiProgram("Powerbuilding", [new AiDay(null, null, 11, 1, "Squat Test", false, null, [
            new AiExercise("Back Squat", null, null, [new AiSet(1, 1, 10, 270, null, "100-105% 1RM", null)], SourcePage: 66),
            new AiExercise("Single-Arm Lat Pulldown", null, null, [new AiSet(12, 12, 8, 150, null, null, null)], SourcePage: 66),
            new AiExercise("Incline Dumbbell Curl", null, null, [new AiSet(12, 12, 8, 90, null, null, null)], SourcePage: 66)
        ], 66)]);
        const string text = """
            === PAGE 66 ===
            WEEK 10B
            DAY LABEL: SQUAT TEST
            WORKOUT | EXERCISE | WARM-UP SETS | WORKING SETS | REPS | %1RM RPE | REST | SET 1 | SET 2 | SET 3 | SET 4 | NOTES
             | BACK SQUAT | 5 | 1-3 | 1 | 100-105% 9.5 | 4-5 MIN |  |  |  |  | AIM FOR A NEW PR. USE GOOD FORM!
             | SINGLE-ARM LAT PULLDOWN | 1 | 2 | 12 | N/A 8 | 2-3 MIN |  |  |  |  | DRIVE ELBOWS DOWN AND IN
             | INCLINE DUMBBELL CURL | 0 | 4 | 12 | N/A 8 | 1-2 MIN |  |  |  |  | FOCUS ON THE MIND-MUSCLE CONNECTION
             | STANDING CALF RAISE | 1 | 3 | 12 | N/A 8 | 1-2 MIN |  |  |  |  | FULL SQUEEZE AT THE TOP
            """;

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        Assert.Equal(["BACK SQUAT", "SINGLE-ARM LAT PULLDOWN", "INCLINE DUMBBELL CURL", "STANDING CALF RAISE"],
            exercises.Select(exercise => exercise.SourceName));
        Assert.Contains("Printed working-set prescription: 1-3.", exercises[0].CoachingNotes);
        Assert.Equal("1", exercises[0].WorkingSets);
        Assert.Equal(3, exercises[^1].Sets.Count);
        Assert.All(exercises[^1].Sets, set => Assert.Equal(90, set.RestSeconds));
    }

    [Fact]
    public void Variable_working_set_counts_keep_the_printed_prescription_and_recover_dropped_rows()
    {
        var program = new AiProgram("Variable sets", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Squat", null, null, [new AiSet(1, 1, null, null, null, null, null)], SourcePage: 15)
        ], 15)]);
        const string text = """
            === PAGE 15 ===
            Exercise | Working Sets | Reps | RPE | Rest
            Squat | 1+ | 1 | 9 | 3-5 min
            Calf Raise | 2 or 3 | 12 | 8 | 60 sec
            """;

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        Assert.Equal(["Squat", "Calf Raise"], exercises.Select(exercise => exercise.SourceName));
        Assert.Contains("Printed working-set prescription: 1+.", exercises[0].CoachingNotes);
        Assert.Contains("Printed working-set prescription: 2 or 3.", exercises[1].CoachingNotes);
        Assert.Equal("2", exercises[1].WorkingSets);
        Assert.Equal(2, exercises[1].Sets.Count);
    }

    [Fact]
    public void Clean_warmup_tables_recover_absent_and_fused_set_repetition_cells()
    {
        var program = new AiProgram("Warmup", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Low intensity cardio", null, null, [new AiSet(5, 10, null, null, null, null, null)], SourcePage: 16)
        ], 16)]);
        const string text = """
            === PAGE 16 ===
            Exercise | Sets | Reps/Time | Notes
            Low intensity cardio | N/A | 5-10min | Warm up until breathing increases
            Front/back leg swing | 1 12 | | 12 each leg
            (Optional) Overhead shrug | 1 15 | | Squeeze traps lightly
            """;

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        Assert.Equal(["Low intensity cardio", "Front/back leg swing", "(Optional) Overhead shrug"],
            exercises.Select(exercise => exercise.SourceName));
        Assert.Equal("12", exercises[1].Sets[0].RepsText);
        Assert.Equal("15", exercises[2].Sets[0].RepsText);
    }

    [Fact]
    public void Approximate_minute_ranges_replace_drifted_rest_values()
    {
        var program = new AiProgram("Rest", [new AiDay(null, null, 4, 1, "Arms & Weak Points #2", false, null, [
            new AiExercise("Single-Arm Triceps Pressdown", null, null,
                [new AiSet(12, 15, 9, 90, null, null, null, RestText: "90 sec", SourcePage: 37)], SourcePage: 37)
        ], 37)]);
        const string text = """
            === PAGE 37 ===
            DAY LABEL: Arms & Weak Points #2
            Exercise | Warm-up Sets | Working Sets | Reps | Early Set RPE | Last Set RPE | Rest
            Single-Arm Triceps Pressdown | 1 | 2 | 12-15 | 9 | 10 | ~1-2 min
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.All(exercise.Sets, set => Assert.Equal(("~1-2 min", 90), (set.RestText, set.RestSeconds)));
    }

    [Fact]
    public void Identical_repeated_rest_values_from_fused_cells_are_recovered()
    {
        var program = new AiProgram("Repeated rest", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Cable Row", null, null,
                [new AiSet(8, 10, 8, 90, null, null, null, RestText: "90 sec", SourcePage: 18)], SourcePage: 18)
        ], 18)]);
        const string text = """
            === PAGE 18 ===
            Exercise | Working Sets | Reps | RPE | Rest
            Cable Row | 2 | 8-10 | 8 | 2-3 min 2-3 min
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.All(exercise.Sets, set => Assert.Equal(("2-3 min", 150), (set.RestText, set.RestSeconds)));
    }

    [Fact]
    public void Printed_prescription_is_recovered_from_a_full_day_table_with_adjacent_notes_and_options()
    {
        var program = new AiProgram("Source", [new AiDay("Block 1", "5-week climb phase", 4, 4,
            "Arms & Weak Points #2", false, null, [
                new AiExercise("Single-Arm Triceps Pressdown", null, null,
                    [new AiSet(12, 15, null, 90, null, null, null, RestText: "90 sec", SourcePage: 37)], SourcePage: 37)
            ], 37)]);
        const string text = """
            === PAGE 37 ===
            BLOCK 1: 5-WEEK CLIMB PHASE
            DAY LABEL: Arms & Weak Points #2
            Exercise | Last-Set Intensity Technique | Warm-up Sets | WORKING SETS | Reps | SET 1 | SET 2 | SET 3 | SET 4 | Early Set RPE | Last Set RPE | Rest | Substitution Option 1 | Substitution Option 2 | NOTES
            Weak Point Exercise 1 (optional) | N/A | 1-3 | 3 | 8-12 | | | | | ~9 | ~9-10 | ~1-3 min | | | Perform one exercise from the weak point table.
            Weak Point Exercise 2 (optional) | N/A | 1-3 | 3 | 8-12 | | | | | ~9 | ~9-10 | ~1-3 min | | | This second exercise is optional.
            DB Hammer Curl | Failure | 1 | 3 | 10-12 | | | | | ~9 | 10 | ~1-2 min | Hammer Preacher Curl | Reverse-Grip EZ-Bar Curl | Squeeze the handle hard.
            Smith Machine JM Press | Failure | 1 | 3 | 10-12 | | | | | ~9 | 10 | ~1-2 min | Barbell JM Press | Close-Grip Bench Press | Lower the bar to your chin.
            DB Scott Curl | Biceps Static Stretch (30 sec) | 1 | 2 | 12-15 | | | | | ~9 | 10 | ~1-2 min | EZ-Bar Preacher Curl | DB Preacher Curl | Pause at the bottom.
            Single-Arm Triceps Pressdown | Triceps Static Stretch (30 sec) | 1 | 2 | 12-15 | | | | | ~9 | 10 | ~1-2 min | Triceps Pressdown (Bar) | DB Triceps Kickback | Squeeze your triceps.
            Decline Weighted Crunch | Failure | 1 | 3 | 12-15 | | | | | ~9 | 10 | ~1-2 min | Ab Wheel Rollout | Swiss Ball Rollout | Maintain a mind muscle connection.
            """;

        var exercise = Assert.Single(ImportTableEvidence.Enrich(program, text).Days![0].Exercises,
            exercise => exercise.SourceName == "Single-Arm Triceps Pressdown");

        Assert.All(exercise.Sets, set => Assert.Equal(("~1-2 min", 90), (set.RestText, set.RestSeconds)));
    }

    [Fact]
    public void Source_recovery_uses_rows_with_unicode_wrapped_cells_after_normalization()
    {
        const string separator = "\u2028";
        var source = "DAY LABEL: Arms\nExercise | Last-Set Intensity Technique | WORKING SETS | Reps | Rest\n"
            + $"Pressdown | Static Stretch{separator}(30 sec) | 2 | 12-15 | ~1-2 min";
        var page = Assert.Single(ImportSourceText.Normalize(new ImportSourceInput("source.pdf", 1,
            [new ImportPageText(1, source)])));
        var program = new AiProgram("Source", [new AiDay(null, null, 1, 1, "Arms", false, null, [
            new AiExercise("Pressdown", null, null,
                [new AiSet(12, 15, null, 90, null, null, null, RestText: "90 sec", SourcePage: 1)], SourcePage: 1)
        ], 1)]);

        var text = ImportSourceText.Slice([page], 1, 1);
        var exercise = Assert.Single(ImportTableEvidence.Enrich(program, text).Days![0].Exercises);

        Assert.All(exercise.Sets, set => Assert.Equal(("~1-2 min", 90), (set.RestText, set.RestSeconds)));
    }

    [Fact]
    public async Task A_set_without_a_page_inherits_its_exercise_source_page()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var program = new AiProgram("Source", [new AiDay(null, null, 1, 1, "Arms", false, null, [
            new AiExercise("Pressdown", null, null,
                [new AiSet(12, 15, 9, 90, null, null, null)], SourcePage: 12)
        ], 12)]);

        var draft = await harness.Imports(StubHandler.Program("{}")).ToDraft(program, default);

        Assert.Equal(12, Assert.Single(Assert.Single(draft.Workouts).Exercises).Sets.Single().SourcePage);
    }

    [Fact]
    public void Explicit_superset_tag_splits_fused_names_and_paired_prescriptions()
    {
        var program = new AiProgram("Pair", [new AiDay(null, null, 2, 1, "Lower 2", false, null, [
            new AiExercise("Single-Leg Hip Thrust A1: Glute-Ham Raise [OR Nordic Ham Curl]", null, null,
                [new AiSet(8, 10, 9, 90, null, null, null, SourcePage: 43)], SourcePage: 43)
        ], 43)]);
        const string text = """
            === PAGE 43 ===
            DAY LABEL: LOWER 2
            EXERCISE | WARM-UP SETS | WORKING SETS | REPS | %1RM RPE | REST | NOTES
            SINGLE-LEG HIP THRUST A1: GLUTE-HAM RAISE [OR NORDIC HAM CURL] | 2 0 | 2 EACH 3 | 10-12 6-8 | N/A 9 N/A 9 | 2-3 MIN 0 MIN | CONTRACT GLUTES AND KEEP HIPS STRAIGHT
            """;

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        Assert.Equal(["SINGLE-LEG HIP THRUST", "GLUTE-HAM RAISE [OR NORDIC HAM CURL]"],
            exercises.Select(exercise => exercise.SourceName));
        Assert.Equal(["2", "3"], exercises.Select(exercise => exercise.WorkingSets));
        Assert.Equal(["10-12", "6-8"], exercises.Select(exercise => exercise.Sets[0].RepsText));
        Assert.Equal([150, 0], exercises.Select(exercise => exercise.Sets[0].RestSeconds));
        Assert.Null(exercises[0].SequenceGroup);
        Assert.Equal("A1", exercises[1].SequenceGroup);
    }

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
    public void Amrap_in_the_technique_column_is_preserved_as_a_last_set_technique()
    {
        var program = new AiProgram("Technique", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Cable Curl", null, null, [new AiSet(8, 12, null, null, null, null, null)], SourcePage: 12)
        ], 12)]);
        const string text = """
            === PAGE 12 ===
            Exercise | Working Sets | Reps | RPE | Last-Set Intensity Technique | Rest
            Cable Curl | 3 | 8-12 | 8 | AMRAP | 60 sec
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.Equal(3, exercise.Sets.Count);
        Assert.Equal("AMRAP", exercise.Sets[^1].Notes);
        Assert.All(exercise.Sets, set => Assert.Equal(8, set.TargetRpe));
    }

    [Fact]
    public void An_effort_range_outside_the_rpe_scale_stays_unresolved()
    {
        var program = new AiProgram("Invalid effort", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Bench Press", null, null, [new AiSet(8, 10, null, null, null, null, null, RpeSource: "inferred")], SourcePage: 14)
        ], 14)]);
        const string text = """
            === PAGE 14 ===
            Exercise | Sets | Reps | RPE | Rest
            Bench Press | 3 | 8-10 | 1-9 | 90 sec
            """;

        var set = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises).Sets[0];

        Assert.Null(set.TargetRpe);
        Assert.Equal("inferred", set.RpeSource);
    }

    [Fact]
    public void Pure_bodybuilding_pages_12_and_13_restore_missing_early_and_last_set_rpe()
    {
        var program = new AiProgram("Pure Bodybuilding Phase 2", [
            new AiDay("Block 1", "Build", 1, 1, "Legs #2", false, null, [
                NewExercise("Seated Leg Curl", 12),
                NewExercise("Barbell RDL", 12)
            ], 12),
            new AiDay("Block 1", "Build", 1, 1, "Arms & Weak Points #2", false, null, [
                NewExercise("Weak Point Exercise 1 (optional)", 13)
            ], 13)
        ]);
        const string text = """
            === PAGE 12 ===
            WEEK 1
            Exercise | Warm-up Sets | Working Sets | Reps | Early Set RPE | Last Set RPE | Rest (min)
            Seated Leg Curl | 3 | 2 | 10-12 | 6 | 8 | 2
            Barbell RDL | 2 | 2 | 6-8 | 5 | 7 | 3
            === PAGE 13 ===
            WEEK 1
            Exercise | Warm-up Sets | Working Sets | Reps | Early Set RPE | Last Set RPE | Rest (min)
            Weak Point Exercise 1 (optional) | 1 | 2 | 10-12 | 7 | 9 | 2
            """;

        var enriched = ImportTableEvidence.Enrich(program, text);
        var exercises = enriched.Days!.SelectMany(day => day.Exercises).ToList();

        Assert.Equal(3, exercises.Count);
        Assert.Equal([6d, 8d], exercises[0].Sets.Select(set => set.TargetRpe));
        Assert.Equal([null, 7d], exercises[1].Sets.Select(set => set.TargetRpe));
        Assert.Equal([7d, 9d], exercises[2].Sets.Select(set => set.TargetRpe));
        Assert.All(exercises.SelectMany(exercise => exercise.Sets), set => Assert.Equal("extracted", set.RpeSource));
        Assert.Equal(["5", "3"], exercises[1].Sets.Select(set => set.Rir));
        Assert.Equal(["2", "2", "2"], exercises.Select(exercise => exercise.WarmupSets));
    }

    [Fact]
    public void Rpe_five_is_kept_as_five_rir_without_reporting_the_target_as_missing()
    {
        var draft = new ImportDraft("Pure Bodybuilding", [new DraftWorkout(Guid.NewGuid(), 1, "Legs #2", null, null, [
            new DraftExercise(Guid.NewGuid(), "Barbell RDL", null, null, [
                new DraftSet(6, 8, null, null, null, null, null, Rir: "5", RpeSource: "extracted")
            ], SourcePage: 12)
        ], SourcePage: 12)]);

        var issues = ImportValidation.ReviewIssues(draft);

        Assert.DoesNotContain(issues, issue => issue.Code == "rpe_unspecified");
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

    private static AiExercise NewExercise(string name, int page)
        => new(name, null, null, [new AiSet(1, 1, null, null, null, null, null, SourcePage: page)],
            WarmupSets: "2", WorkingSets: "2", SourcePage: page);

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
    public void One_to_one_positional_match_repairs_the_name_and_preserves_valid_model_prescriptions()
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

        Assert.Equal("Barbell Squat", exercise.SourceName);
        Assert.Equal("4", exercise.WorkingSets);
        Assert.Equal(4, exercise.Sets.Count);
        var set = exercise.Sets[0];
        Assert.Equal((5, 7, "5-7", 8, "40 kg", "45 sec", 45, "2"),
            (set.RepMin, set.RepMax, set.RepsText, set.TargetRpe, set.LoadText, set.RestText, set.RestSeconds, set.Rir));
    }

    [Fact]
    public void Single_workout_positional_repair_restores_fused_names_and_prescription_cells()
    {
        var program = new AiProgram("Min-Max", [new AiDay(null, null, 2, 2, "Lower 2", false, null, [
            new AiExercise("Smith Machine Leg Press Squat", null, null,
                [new AiSet(1, 1, null, null, null, null, null, RpeSource: "inferred")], SourcePage: 33),
            new AiExercise("Cable Triceps Kickback Machine", null, null,
                [new AiSet(1, 1, null, null, null, null, null, RpeSource: "inferred")], SourcePage: 34)
        ], 33)]);
        const string text = """
            === PAGE 33 ===
            Exercise | Working Sets | Rep Range | Tracking Load Set 1 | Tracking Reps Set 1 | Tracking Load Set 2 | Tracking Reps Set 2 | RIR Set 1 | RIR Set 2 | Rest
            Leg Press | 1 | 6-8 | | | | | 0 | N/A | 2-3 min
            Cable Triceps Kickback | 2 | 8-10 | | | | | 0 | 0 | 1-2 min
            """;
        var enriched = ImportTableEvidence.Enrich(program, text);
        var exercises = Assert.Single(enriched.Days!).Exercises;

        Assert.Equal(["Leg Press", "Cable Triceps Kickback"], exercises.Select(exercise => exercise.SourceName));
        Assert.Equal(["1", "2"], exercises.Select(exercise => exercise.WorkingSets));
        Assert.Equal([10d, 10d], exercises.Select(exercise => exercise.Sets[0].TargetRpe));
        Assert.Equal(["6-8", "8-10"], exercises.Select(exercise => exercise.Sets[0].RepsText));
        Assert.Equal([150, 90], exercises.Select(exercise => exercise.Sets[0].RestSeconds));
        Assert.Single(exercises[0].Sets);
        Assert.Equal(["0", "0"], exercises[1].Sets.Select(set => set.Rir));
    }

    [Fact]
    public void Positional_repair_is_refused_for_multiple_workouts_on_a_page()
    {
        var program = new AiProgram("Two tables", [
            new AiDay(null, null, 1, 1, "Upper", false, null, [
                new AiExercise("Fused upper name", null, null, [new AiSet(1, 1, null, null, null, null, null)], SourcePage: 44)
            ], 44),
            new AiDay(null, null, 1, 1, "Lower", false, null, [
                new AiExercise("Fused lower name", null, null, [new AiSet(1, 1, null, null, null, null, null)], SourcePage: 44)
            ], 44)
        ]);
        const string text = """
            === PAGE 44 ===
            Exercise | Sets | Reps | RPE | Rest
            Barbell Row | 2 | 6-8 | 8 | 90 sec
            Squat | 3 | 8-10 | 9 | 120 sec
            """;

        var days = ImportTableEvidence.Enrich(program, text).Days!;

        Assert.Equal(["Fused upper name", "Fused lower name"], days.Select(day => day.Exercises.Single().SourceName));
        Assert.All(days, day => Assert.Null(day.Exercises.Single().WorkingSets));
    }

    [Fact]
    public void Positional_repair_is_refused_when_exercise_and_source_row_counts_differ()
    {
        var program = new AiProgram("Mismatch", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Fused first", null, null, [new AiSet(1, 1, null, null, null, null, null)], SourcePage: 45),
            new AiExercise("Fused second", null, null, [new AiSet(1, 1, null, null, null, null, null)], SourcePage: 45),
            new AiExercise("Fused third", null, null, [new AiSet(1, 1, null, null, null, null, null)], SourcePage: 45)
        ], 45)]);
        const string text = """
            === PAGE 45 ===
            Exercise | Sets | Reps | RPE | Rest
            Barbell Row | 2 | 6-8 | 8 | 90 sec
            Squat | 3 | 8-10 | 9 | 120 sec
            """;

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        Assert.Equal(["Fused first", "Fused second", "Fused third"], exercises.Select(exercise => exercise.SourceName));
        Assert.All(exercises, exercise => Assert.Null(exercise.WorkingSets));
    }

    [Theory]
    [InlineData("Suggested Rest Day")]
    [InlineData("Mandatory Rest Day")]
    [InlineData("1-2 Rest Days")]
    public void Rest_day_footer_variants_are_recognized(string label)
    {
        var program = new AiProgram("Rest", [new AiDay(null, null, 1, 1, "", false, null, [], 41)]);
        var text = $"=== PAGE 41 ===\n{label}";

        Assert.True(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).IsRestDay);
    }

    [Fact]
    public void Third_and_fourth_rir_columns_apply_to_their_own_sets()
    {
        var program = new AiProgram("Four sets", [new AiDay(null, null, 1, 1, "Week 1 day 1", false, null, [
            new AiExercise("Squat", null, null,
                Enumerable.Range(0, 4).Select(_ => new AiSet(6, 8, null, null, null, null, null)).ToList(), SourcePage: 61)
        ], 61)]);
        const string text = """
            === PAGE 61 ===
            Exercise | Working Sets | Rep Range | RIR Set 1 | RIR Set 2 | RIR Set 3 | RIR Set 4 | Rest
            Squat | 4 | 6-8 | 0 | 1 | 2 | 3 | 2 min
            """;

        var sets = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises).Sets;

        Assert.Equal(["0", "1", "2", "3"], sets.Select(set => set.Rir));
        Assert.Equal([10d, 9d, 8d, 7d], sets.Select(set => set.TargetRpe));
    }

    [Fact]
    public void Day_label_marker_cannot_become_a_movement_name()
    {
        var program = new AiProgram("Marker", [new AiDay(null, null, 1, 1, "Model Day", false, null, [
            new AiExercise("Barbell Row", null, null, [new AiSet(1, 1, null, null, null, null, null)], SourcePage: 62)
        ], 62)]);
        const string text = """
            === PAGE 62 ===
            Exercise | Sets | Reps | RPE | Rest
            DAY LABEL: Upper 1
            | 2 | 8-10 | 8 | 90 sec
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.Equal("Barbell Row", exercise.SourceName);
        Assert.Equal("2", exercise.WorkingSets);
    }

    [Fact]
    public void Reconstructed_table_row_restores_exercise_without_fusion_and_recovers_rpe_range()
    {
        var program = new AiProgram("PPL", [new AiDay("Phase 1", "Phase 1", 1, 1, "Push 1", false, null, [
            new AiExercise("Bench Press", null, null, [
                new AiSet(1, 1, null, null, null, null, null)], SourcePage: 35)
        ], 35)]);
        const string text = """
            === PAGE 35 ===
            Exercise | Warm-up Sets | WORKING SETS | Reps | %1RM / RPE | RIR | Rest | Substitutions 1 | Substitutions 2 | Notes
            Bench Press | 3-4 | 2 | 3-5 | 8-9 | | ~3-4 min | DB Bench Press | Machine Chest Press | Set up a comfortable arch, quick pause on the chest and explode up on each rep.
            """;

        var enriched = ImportTableEvidence.Enrich(program, text);
        var exercise = Assert.Single(Assert.Single(enriched.Days!).Exercises);

        Assert.Equal("Bench Press", exercise.SourceName);
        Assert.Equal("2", exercise.WorkingSets);
        Assert.Equal(2, exercise.Sets.Count);
        Assert.All(exercise.Sets, set =>
        {
            Assert.Equal(3, set.RepMin);
            Assert.Equal(5, set.RepMax);
            Assert.Equal(9.0, set.TargetRpe);
            Assert.Equal("1", set.Rir);
            Assert.Equal("~3-4 min", set.RestText);
        });
    }

    [Fact]
    public void Silent_rpe_and_rir_leaves_target_rpe_null_without_inventing_values()
    {
        var program = new AiProgram("Silent RPE", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("Calf Raise", null, null, [new AiSet(10, 12, null, null, null, null, null)], SourcePage: 40)
        ], 40)]);
        const string text = """
            === PAGE 40 ===
            Exercise | Sets | Reps | Rest
            Calf Raise | 3 | 10-12 | 2 min
            """;

        var enriched = ImportTableEvidence.Enrich(program, text);
        var exercise = Assert.Single(Assert.Single(enriched.Days!).Exercises);

        Assert.Equal("3", exercise.WorkingSets);
        Assert.All(exercise.Sets, set => Assert.Null(set.TargetRpe));
    }

    /// The Pure Bodybuilding Program prints a technique column ("Myo-reps") and a coaching note
    /// ("sweep the weight up") on every row. Both name a header word, and the first row was taken
    /// for a new header, so every later row lost its RPE and rest and one borrowed its neighbour.
    [Fact]
    public void A_data_row_that_mentions_header_words_is_not_read_as_a_new_header()
    {
        var program = new AiProgram("Pure Bodybuilding", [new AiDay("Block 1", null, 1, 1, "Upper #1", false, null, [
            new AiExercise("Cuffed Behind-The-Back Lateral Raise", null, null, [new AiSet(10, 12, null, null, null, null, null)], SourcePage: 6),
            new AiExercise("Leg Press", null, null, [new AiSet(8, 8, null, null, null, null, null)], SourcePage: 6)
        ], 6)]);
        const string text = """
            === PAGE 6 ===
            Exercise | Last-Set Intensity Technique | Warm-up Sets | WORKING SETS | Reps | SET 1 | Tracking Load and Reps SET 2 | Early Set RPE | Last Set RPE | Rest | Substitution Option 1 | NOTES
            Cuffed Behind-The-Back Lateral Raise | Myo-reps | 1-2 | 3 | 10-12 |  |  | ~9 | 10 | ~1-2 min | DB Lateral Raise | Really try to connect with the middle delt fibers as you sweep the weight up and out.
            Leg Press | Long-length Partials (on all reps of the last set) | 2-4 | 2 | 8 |  |  | ~7 | ~8 | ~3-4 min | Belt Squat | Rest the weight in the bottom for a second and keep your reps smooth.
            """;

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        Assert.Equal(["Cuffed Behind-The-Back Lateral Raise", "Leg Press"], exercises.Select(exercise => exercise.SourceName));
        Assert.Equal([9d, 9d, 10d], exercises[0].Sets.Select(set => set.TargetRpe));
        Assert.Equal([7d, 8d], exercises[1].Sets.Select(set => set.TargetRpe));
        Assert.Equal(210, exercises[1].Sets[0].RestSeconds);
    }

    /// Fundamentals prints the day title where the name column is labelled. The rows still name
    /// their movements there, so two workouts on one page each find their own rows by name.
    [Fact]
    public void A_day_title_in_the_name_column_header_still_names_the_movement_column()
    {
        var program = new AiProgram("Fundamentals", [
            new AiDay(null, null, 4, 1, "Day 1", false, null, [
                new AiExercise("Back Squat", null, null, [new AiSet(6, 6, null, null, null, null, null)], SourcePage: 40)], 40),
            new AiDay(null, null, 4, 1, "Day 2", false, null, [
                new AiExercise("Deadlift", null, null, [new AiSet(5, 5, null, null, null, null, null)], SourcePage: 40)], 40)
        ]);
        const string text = """
            === PAGE 40 ===
            DAY LABEL: DAY 1
            FULL BODY #1 | SETS | REPS | RPE | REST | 1 | 2 | 3 | NOTES | LSRPE
            BACK SQUAT | 3 | 6 | 7 | 3-4MIN |  |  |  | SIT BACK AND DOWN
            DAY LABEL: DAY 2
            FULL BODY #2 | SETS | REPS | RPE | REST | 1 | 2 | 3 | NOTES | LSRPE
            DEADLIFT | 2 | 5 | 8 | 3-4MIN |  |  |  | BRACE YOUR LATS
            """;

        var days = ImportTableEvidence.Enrich(program, text).Days!;

        Assert.Equal([7d, 7d, 7d], Assert.Single(days[0].Exercises).Sets.Select(set => set.TargetRpe));
        Assert.Equal([8d, 8d], Assert.Single(days[1].Exercises).Sets.Select(set => set.TargetRpe));
    }

    [Fact]
    public void A_per_side_set_count_is_still_the_working_set_count()
    {
        var program = new AiProgram("Pure Bodybuilding Phase 2", [new AiDay(null, null, 2, 1, "Legs #2", false, null, [
            new AiExercise("Smith Machine Reverse Lunge", null, null, [new AiSet(10, 12, null, null, null, null, null)], SourcePage: 20)
        ], 20)]);
        const string text = """
            === PAGE 20 ===
            Exercise | Last-Set Intensity Technique | Warm-up Sets | WORKING SETS | Reps | Early Set RPE | Last Set RPE | Rest
            Smith Machine Reverse Lunge | Quad Static Stretch (30 sec) | 2-3 | 2 per leg | 10-12 | ~8-9 | ~9-10 | ~2-3 min
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.Equal("2", exercise.WorkingSets);
        Assert.Equal(2, exercise.Sets.Count);
    }

    [Fact]
    public void Session_set_volume_summary_is_not_exercise_evidence()
    {
        var program = new AiProgram("Program", [new AiDay(null, null, 1, 1, "Day 1", false, null, [
            new AiExercise("SESSION SET VOLUME", null, null, [new AiSet(1, 1, null, null, null, null, null)], SourcePage: 6)
        ], 6)]);
        const string text = """
            === PAGE 6 ===
            Exercise | Sets | Reps | RPE | Rest
            SESSION SET VOLUME | 12 | - | - | -
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.Null(exercise.WorkingSets);
        Assert.Single(exercise.Sets);
        Assert.Null(exercise.Sets[0].TargetRpe);
        Assert.Null(exercise.Sets[0].RestText);
    }

    /// Pure Bodybuilding prints "Weak Point Exercise 2 (optional)" every week; a read that dropped
    /// the qualifier on some days split the one movement into two slots to map.
    [Fact]
    public void A_read_that_drops_a_printed_qualifier_takes_the_printed_name()
    {
        var program = new AiProgram("Pure Bodybuilding", [new AiDay(null, null, 1, 1, "Arms & Weak Points", false, null, [
            new AiExercise("Weak Point Exercise 2", null, null, [new AiSet(8, 12, null, null, null, null, null)], SourcePage: 10)
        ], 10)]);
        const string text = """
            === PAGE 10 ===
            Exercise | Last-Set Intensity Technique | Warm-up Sets | WORKING SETS | Reps | Early Set RPE | Last Set RPE | Rest
            Weak Point Exercise 1 | N/A | 1-3 | 3 | 8-12 | ~9 | ~9-10 | ~1-3 min
            Weak Point Exercise 2 (optional) | N/A | 1-3 | 2 | 8-12 | ~9 | ~9-10 | ~1-3 min
            """;

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        // The page is a clean table, so Weak Point Exercise 1, which the read left out, comes back.
        Assert.Equal(["Weak Point Exercise 1", "Weak Point Exercise 2 (optional)"], exercises.Select(exercise => exercise.SourceName));
        Assert.Equal(2, exercises[1].Sets.Count);
    }

    /// Weeks 6-10 print "N/A" rest for both halves of the hip superset. A rest time the model
    /// supplied there was not printed, so it must not enter the program as if it were.
    [Fact]
    public void A_rest_printed_as_not_applicable_clears_a_rest_the_model_supplied()
    {
        var program = new AiProgram("Pure Bodybuilding", [new AiDay(null, null, 8, 1, "Lower #2", false, null, [
            new AiExercise("Machine Hip Adduction", null, null, [new AiSet(10, 12, 9, 45, null, null, null, RestText: "~0.5-1 min")], SourcePage: 44)
        ], 44)]);
        const string text = """
            === PAGE 44 ===
            Exercise | Last-Set Intensity Technique | Warm-up Sets | WORKING SETS | Reps | Early Set RPE | Last Set RPE | Rest
            A1: Machine Hip Adduction | N/A | 1 | 3 | 10-12 | ~9-10 | 10 | N/A
            """;

        var exercise = Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises);

        Assert.All(exercise.Sets, set => Assert.Equal((null, null), (set.RestSeconds, set.RestText)));
    }

    /// Min-Max Phase 2 prints "1-2 Rest Days" after Lower and Pull. The read kept that rest day in
    /// some weeks and dropped it in others (weeks 5, 6 and 12 had none).
    [Fact]
    public void A_counted_rest_day_band_the_read_dropped_gains_one_rest_day()
    {
        static AiDay Training(string name, int page) => new(null, null, 5, 1, name, false, null, [
            new AiExercise("Squat", null, null, [new AiSet(6, 8, null, null, null, null, null)], SourcePage: page)], page);
        var program = new AiProgram("Min-Max Phase 2", [Training("Lower", 43), Training("Push", 44), Training("Pull", 45),
            new AiDay(null, null, 5, 1, "Rest Day", true, null, [], 45)]);
        const string text = """
            === PAGE 43 ===
            WEEK 5
            1-2 Rest Days
            === PAGE 44 ===
            WEEK 5
            === PAGE 45 ===
            WEEK 5
            1-2 REST DAYS
            """;

        var days = ImportTableEvidence.Enrich(program, text).Days!;

        Assert.Equal(["Lower", "Rest Day", "Push", "Pull", "Rest Day"], days.Select(day => day.DayName));
        Assert.True(days[1].IsRestDay);
        Assert.Equal(5, days[1].WeekNumber);
    }
}
