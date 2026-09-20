using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportSlotMappingTests
{
    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source() => new("min-max.pdf", 4,
        Enumerable.Range(1, 4).Select(page => new ImportPageText(page,
            $"{(page <= 2 ? "BLOCK 1" : "BLOCK 2")}{(page == 3 ? "\nDELOAD WEEK" : "")}\nWEEK {page}\nSquat 2 x 6-8")).ToList());

    private static string Program => $$"""
        {"programName":"Min-Max","programTitle":"Min-Max","days":[
          {"block":"BLOCK 1","phase":"Base","weekNumber":1,"phaseWeek":1,"dayName":"Lower 1","isRestDay":false,"notes":null,"sourcePage":1,"exercises":[{"sequenceGroup":"A1","sourceName":"Squat (Your Choice)","exerciseId":null,"notes":null,"sourcePage":1,"sets":[{"repMin":6,"repMax":8,"targetRpe":8,"restSeconds":120,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted"}]}]},
          {"block":"Block 1","phase":"Base","weekNumber":2,"phaseWeek":2,"dayName":"Lower 1","isRestDay":false,"notes":null,"sourcePage":2,"exercises":[{"sequenceGroup":"A1","sourceName":"Squat","exerciseId":null,"notes":null,"sourcePage":2,"sets":[{"repMin":6,"repMax":8,"targetRpe":8,"restSeconds":120,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted"}]}]},
          {"block":"Block 2","phase":"Deload Week","weekNumber":3,"phaseWeek":1,"dayName":"Lower 1","isRestDay":false,"notes":null,"sourcePage":3,"exercises":[{"sequenceGroup":"A1","sourceName":"Squat (Your Choice)","exerciseId":null,"notes":null,"sourcePage":3,"sets":[{"repMin":6,"repMax":8,"targetRpe":8,"restSeconds":120,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted"}]}]},
          {"block":"BLOCK 2","phase":"Base","weekNumber":4,"phaseWeek":1,"dayName":"Lower 1","isRestDay":false,"notes":null,"sourcePage":4,"exercises":[{"sequenceGroup":"A1","sourceName":"Smith Machine Leg Press Squat","exerciseId":null,"notes":null,"sourcePage":4,"sets":[{"repMin":6,"repMax":8,"targetRpe":8,"restSeconds":120,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted"}]}]}
        ]}
        """;

    [Fact]
    public async Task Mapping_one_exact_recurring_choice_propagates_across_blocks_without_merging_other_names()
    {
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        await harness.Seed(new SeedExercise("bench", "Barbell Bench Press", "Chest", "Barbell", "", null));
        var benchId = await harness.ExerciseId("bench");
        var imports = harness.Imports(StubHandler.Program(Program));

        var view = await imports.Create(Source(), default);

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
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        await harness.Seed(new SeedExercise("bench", "Barbell Bench Press", "Chest", "Barbell", "", null));
        var imports = harness.Imports(StubHandler.Program(Program));
        var view = await imports.Create(Source(), default);
        var line = view.Unresolved[0].LineId;
        var benchId = await harness.ExerciseId("bench");

        var error = await Assert.ThrowsAsync<DomainException>(() => imports.MapSlot(view.Id, line, benchId, view.Revision - 1, default));
        Assert.Equal(409, error.Status);
    }
}
