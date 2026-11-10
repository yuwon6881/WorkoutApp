using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportSlotMappingTests
{
    private static string Day(int week, string block, string phase, int phaseWeek, string exercise)
        => $$"""{"key":"w{{week}}","week":{{week}},"name":"Lower 1","block":"{{block}}","phase":"{{phase}}","phaseWeek":{{phaseWeek}},"exercises":[{"sourceName":"{{exercise}}","sets":[{"repMin":6,"repMax":8,"targetRpe":8,"restSeconds":120}]}]}""";

    private static string Program => ExternalDraftFixture.Program("Min-Max", string.Join(",",
        Day(1, "BLOCK 1", "Base", 1, "Squat (Your Choice)"),
        Day(2, "Block 1", "Base", 2, "Squat"),
        Day(3, "Block 2", "Deload Week", 1, "Squat (Your Choice)"),
        Day(4, "BLOCK 2", "Base", 1, "Smith Machine Leg Press Squat")));

    [Fact]
    public async Task Mapping_one_exact_recurring_choice_propagates_across_blocks_without_merging_other_names()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(new SeedExercise("bench", "Barbell Bench Press", "Chest", "Barbell", null));
        var benchId = await harness.ExerciseId("bench");
        var imports = harness.Imports();

        var view = await ExternalDraftFixture.Create(imports, Program);

        Assert.Equal(3, view.Unresolved.Count);
        var choice = Assert.Single(view.Unresolved, item => item.SourceName == "Squat (Your Choice)");
        Assert.Equal(2, choice.Occurrences);
        Assert.Null(choice.Block);
        Assert.Equal(["Block 1", "Block 2"], view.Draft!.Workouts.Select(workout => workout.Block).Distinct().OrderBy(value => value));

        var draft = view.Draft!;
        var blockOneSlot = draft.Workouts.Where(workout => workout.Block == "Block 1")
            .SelectMany(workout => workout.Exercises).First().SlotKey;
        var reusedSlotDraft = draft with
        {
            Workouts = draft.Workouts.Select(workout => workout.Block == "Block 2"
                ? workout with { Exercises = workout.Exercises.Select(exercise => exercise with { SlotKey = blockOneSlot }).ToList() }
                : workout).ToList()
        };
        view = await imports.Edit(view.Id, reusedSlotDraft, view.Revision, default);
        Assert.Equal(3, view.Unresolved.Count);

        var first = view.Unresolved.Single(item => item.SourceName == "Squat (Your Choice)");
        var mapped = await imports.MapSlot(view.Id, first.LineId, benchId, view.Revision, default);

        var block1 = mapped.Draft!.Workouts.Where(workout => workout.Block == "Block 1").SelectMany(workout => workout.Exercises).ToList();
        var block2 = mapped.Draft.Workouts.Where(workout => workout.Block == "Block 2").SelectMany(workout => workout.Exercises).ToList();
        Assert.Equal(benchId, block1.Single(exercise => exercise.SourceName == "Squat (Your Choice)").ExerciseId);
        Assert.Equal(["Squat (Your Choice)", "Squat"], block1.Select(exercise => exercise.SourceName));
        Assert.Equal(benchId, block2.Single(exercise => exercise.SourceName == "Squat (Your Choice)").ExerciseId);
        Assert.Null(block2.Single(exercise => exercise.SourceName == "Smith Machine Leg Press Squat").ExerciseId);
        Assert.Equal(["Squat", "Smith Machine Leg Press Squat"], mapped.Unresolved.Select(item => item.SourceName));
        Assert.All(mapped.Unresolved, item => Assert.Equal(1, item.Occurrences));
    }

    [Fact]
    public async Task Mapping_requires_the_current_revision()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(new SeedExercise("bench", "Barbell Bench Press", "Chest", "Barbell", null));
        var imports = harness.Imports();
        var view = await ExternalDraftFixture.Create(imports, Program);
        var line = view.Unresolved[0].LineId;
        var benchId = await harness.ExerciseId("bench");

        var error = await Assert.ThrowsAsync<DomainException>(() => imports.MapSlot(view.Id, line, benchId, view.Revision - 1, default));
        Assert.Equal(409, error.Status);
    }
    /// Jeff Nippard's Upper/Lower prints one "UPPER BODY WEAK POINT 1" placeholder in 27 places
    /// and one "LOWER BODY WEAK POINT 1" in 9. They fall on six differently titled days, at
    /// shifting positions within those days, and the read transcribes the trailing ordinal only
    /// some of the time — so keying a choice on day title and position split one decision into
    /// twelve review rows, each wanting its own mapping.
    [Fact]
    public void One_placeholder_is_one_slot_however_the_document_places_it()
    {
        var draft = ImportValidation.NormalizeDraft(new ImportDraft("Upper/Lower",
        [
            Day(1, "Upper #1", Exercise("Barbell Bench Press"), Exercise("UPPER BODY WEAK POINT 1")),
            Day(1, "Lower #1", Exercise("Back Squat"), Exercise("LOWER BODY WEAK POINT 1")),
            // A different day title, a different position, and the ordinal dropped by the read.
            Day(2, "Upper #2", Exercise("Dip"), Exercise("Lat Pulldown"), Exercise("Upper Body Weak Point")),
            Day(2, "Lower #2", Exercise("Deadlift"), Exercise("LOWER BODY WEAK POINT"))
        ]));

        var placeholders = Placeholders(ImportValidation.Unresolved(draft));

        Assert.Equal(2, placeholders.Count);
        Assert.All(placeholders, item => Assert.Equal(2, item.Occurrences));
        Assert.Single(placeholders, item => item.SourceName.StartsWith("Upper", StringComparison.OrdinalIgnoreCase));
        Assert.Single(placeholders, item => item.SourceName.StartsWith("Lower", StringComparison.OrdinalIgnoreCase));
        // One slot identity is what carries a single mapping to every occurrence.
        var upper = draft.Workouts.SelectMany(day => day.Exercises)
            .Where(exercise => exercise.SourceName.StartsWith("Upper", StringComparison.OrdinalIgnoreCase)).ToList();
        Assert.Equal(2, upper.Count);
        Assert.Single(upper.Select(exercise => exercise.SlotKey).Distinct());
    }

    /// An ordinal that genuinely distinguishes two placeholders still separates them.
    [Fact]
    public void Numbered_placeholders_beyond_the_first_stay_separate()
    {
        var draft = ImportValidation.NormalizeDraft(new ImportDraft("Two choices",
        [
            Day(1, "Upper", Exercise("UPPER BODY WEAK POINT 1"), Exercise("UPPER BODY WEAK POINT 2"))
        ]));

        var placeholders = Placeholders(ImportValidation.Unresolved(draft));

        Assert.Equal(["UPPER BODY WEAK POINT 1", "UPPER BODY WEAK POINT 2"],
            placeholders.Select(item => item.SourceName));
    }

    /// Powerbuilding 3.0 has no printed day titles the read could use, so each day was named for
    /// its week ("Week 3 day 2") and a slot keyed on that name never recurred: 91 rows to map
    /// for about twenty movements. The same movement also moves position between weeks, and a
    /// different one takes its place, so the name — not the position — is what one mapping means.
    [Fact]
    public void One_written_movement_is_one_mapping_across_weeks_positions_and_casing()
    {
        var draft = ImportValidation.NormalizeDraft(new ImportDraft("Powerbuilding 3.0",
        [
            Day(1, "Week 1 day 2", Exercise("STRICT BENCH PRESS"), Exercise("SEATED FACE PULL")),
            Day(1, "Week 1 day 3", Exercise("ANDERSON SQUAT")),
            Day(2, "Week 2 day 2", Exercise("STRICT BENCH PRESS"), Exercise("Seated Face Pull")),
            Day(2, "Week 2 day 3", Exercise("BARBELL BOX SQUAT")),
            Day(9, "Week 9 day 3", Exercise("Back Squat"), Exercise("Seated Leg Curl"), Exercise("SEATED FACE PULL"))
        ]));

        var unresolved = ImportValidation.Unresolved(draft);

        Assert.Equal(["STRICT BENCH PRESS", "SEATED FACE PULL", "ANDERSON SQUAT", "BARBELL BOX SQUAT", "Back Squat", "Seated Leg Curl"],
            unresolved.Select(item => item.SourceName));
        Assert.Equal(3, unresolved.Single(item => item.SourceName == "SEATED FACE PULL").Occurrences);
        Assert.Equal(2, unresolved.Single(item => item.SourceName == "STRICT BENCH PRESS").Occurrences);
        // A week-based day name still gives the same session one recurring slot identity.
        var squats = draft.Workouts.Where(day => day.Name.EndsWith("day 3", StringComparison.Ordinal) && day.Week < 9)
            .Select(day => day.Exercises[0].SlotKey).Distinct();
        Assert.Single(squats);
    }

    [Fact]
    public async Task Mapping_a_movement_links_every_occurrence_and_leaves_the_movement_sharing_its_position_alone()
    {
        static string Face(int week, string first, string name, int repMin, int repMax) =>
            $$"""{"key":"w{{week}}","week":{{week}},"name":"Day {{week}}","exercises":[{{first}},{"sourceName":"{{name}}","sets":[{"repMin":{{repMin}},"repMax":{{repMax}},"targetRpe":9,"restSeconds":90}]}]}""";
        static string Lift(string name, int reps) =>
            $$"""{"sourceName":"{{name}}","sets":[{"repMin":{{reps}},"repMax":{{reps}},"targetRpe":6,"restSeconds":180}]}""";
        var program = ExternalDraftFixture.Program("PB3", string.Join(",",
            Face(1, Lift("ANDERSON SQUAT", 8), "SEATED FACE PULL", 15, 20),
            Face(2, Lift("BARBELL BOX SQUAT", 8), "Seated Face Pull", 15, 20),
            $$"""{"key":"w3","week":3,"name":"Day 3","exercises":[{{Lift("STRICT BENCH PRESS", 1)}},{{Lift("Seated Leg Curl", 6)}},{{Lift("SEATED FACE PULL", 12)}}]}"""));
        await using var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(new SeedExercise("rear-fly", "Cable Rear Delt Fly", "Rear delts", "Cable", null));
        var facePull = await harness.ExerciseId("rear-fly");
        var imports = harness.Imports();
        var view = await ExternalDraftFixture.Create(imports, program);
        var row = Assert.Single(view.Unresolved, item => item.SourceName.Equals("Seated Face Pull", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(3, row.Occurrences);

        var mapped = await imports.MapSlot(view.Id, row.LineId, facePull, view.Revision, default);

        var exercises = mapped.Draft!.Workouts.SelectMany(day => day.Exercises).ToList();
        Assert.All(exercises.Where(exercise => exercise.SourceName.Equals("Seated Face Pull", StringComparison.OrdinalIgnoreCase)),
            exercise => Assert.Equal(facePull, exercise.ExerciseId));
        Assert.All(exercises.Where(exercise => !exercise.SourceName.Equals("Seated Face Pull", StringComparison.OrdinalIgnoreCase)),
            exercise => Assert.Null(exercise.ExerciseId));
        Assert.DoesNotContain(mapped.Unresolved, item => item.SourceName.Equals("Seated Face Pull", StringComparison.OrdinalIgnoreCase));
    }

    /// The editor offers to apply an edit to the other occurrences of a movement. It must group
    /// them exactly as a mapping does, so the server publishes that grouping rather than leaving the
    /// client to re-derive it: one key per written movement, independent of the block, which the
    /// client scopes separately.
    [Fact]
    public void Every_exercise_carries_the_key_of_the_movement_it_names()
    {
        var draft = ImportValidation.NormalizeDraft(new ImportDraft("Keys",
        [
            DayInBlock("Block 1", 1, "Week 1 day 2", Exercise("STRICT BENCH PRESS"), Exercise("UPPER BODY WEAK POINT 1")),
            DayInBlock("Block 2", 5, "Week 5 day 3", Exercise("Seated Face Pull"), Exercise("Strict bench press"), Exercise("Upper Body Weak Point"))
        ]));

        var all = draft.Workouts.SelectMany(day => day.Exercises).ToList();
        var bench = all.Where(exercise => exercise.SourceName.Contains("bench", StringComparison.OrdinalIgnoreCase)).ToList();
        Assert.Equal(2, bench.Count);
        Assert.All(bench, exercise => Assert.False(string.IsNullOrEmpty(exercise.MovementKey)));
        Assert.Single(bench.Select(exercise => exercise.MovementKey).Distinct());
        Assert.NotEqual(bench[0].MovementKey, all.Single(exercise => exercise.SourceName == "Seated Face Pull").MovementKey);

        var placeholders = all.Where(exercise => exercise.SourceName.Contains("WEAK POINT", StringComparison.OrdinalIgnoreCase)).ToList();
        Assert.Single(placeholders.Select(exercise => exercise.MovementKey).Distinct());
    }

    /// A row the user added carries the placeholder "New exercise" until it is renamed. Two of them are
    /// two different movements, so they must neither share one mapping nor one "same movement" scope.
    [Fact]
    public void Added_exercises_with_the_placeholder_name_stay_separate_movements()
    {
        var first = Exercise("New exercise");
        var second = Exercise("New exercise");
        var draft = ImportValidation.NormalizeDraft(new ImportDraft("Added", [Day(1, "Day 1", first, second)]));

        var keys = draft.Workouts.Single().Exercises.Select(exercise => exercise.MovementKey).ToList();
        Assert.Equal(2, keys.Distinct().Count());
        Assert.Equal(2, ImportValidation.Unresolved(draft).Count);
        Assert.NotEqual(ImportValidation.MovementKey("New exercise", first.LineId), ImportValidation.MovementKey("New exercise", second.LineId));
        Assert.Equal(ImportValidation.MovementKey("Bench Press", first.LineId), ImportValidation.MovementKey("Bench Press", second.LineId));
    }

    private static DraftWorkout DayInBlock(string block, int week, string name, params DraftExercise[] exercises)
        => new(Guid.NewGuid(), week, name, null, null, [.. exercises], block);

    private static DraftWorkout Day(int week, string name, params DraftExercise[] exercises)
        => new(Guid.NewGuid(), week, name, null, null, [.. exercises]);

    private static DraftExercise Exercise(string sourceName)
        => new(Guid.NewGuid(), sourceName, null, null, [new DraftSet(6, 8, 8, 120, null, null, null)]);
    private static List<UnresolvedExercise> Placeholders(IEnumerable<UnresolvedExercise> unresolved)
        => unresolved.Where(item => item.SourceName.Contains("WEAK POINT", StringComparison.OrdinalIgnoreCase)).ToList();

}
