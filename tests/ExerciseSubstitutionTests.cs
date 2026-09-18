using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ExerciseSubstitutionTests
{
    [Fact]
    public async Task Candidates_keep_unresolved_imports_first_and_rank_similar_movements()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", ["flat bench"], 2.5, Workout.Api.Domain.LoadModels.External, "horizontal_push"),
            new SeedExercise("incline", "Incline dumbbell press", "Chest", "Dumbbell", "", null, 2.5, Workout.Api.Domain.LoadModels.External, "horizontal_push"),
            new SeedExercise("curl", "Dumbbell curl", "Biceps", "Dumbbell", "", null, 2.5, Workout.Api.Domain.LoadModels.External, "elbow_flexion"));
        var bench = await h.ExerciseId("bench");
        var rows = await h.Catalog.Substitutions(bench, null, ["Mystery press"], null, default);
        Assert.Equal("Mystery press", rows[0].Name);
        Assert.Null(rows[0].ExerciseId);
        Assert.Equal("similar", rows[1].Source);
        Assert.Equal("Incline dumbbell press", rows[1].Name);
    }

    [Fact]
    public async Task Template_updates_preserve_slot_key_and_swap_server_side()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null),
            new SeedExercise("incline", "Incline dumbbell press", "Chest", "Dumbbell", "", null));
        var bench = await h.ExerciseId("bench"); var incline = await h.ExerciseId("incline");
        var created = await h.Templates.Create(Harness.Template("Push", Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))), null, 1, 0, default);
        var slot = created.Exercises.Single().SlotKey;
        var updated = await h.Templates.Update(created.Id, new TemplateInput(created.Name, created.Focus, created.Note,
            [new TemplateExerciseInput(bench, "Barbell bench press", null, created.Exercises[0].Sets, SlotKey: slot)], created.Revision, null), default);
        Assert.Equal(slot, updated.Exercises.Single().SlotKey);
        var swapped = await h.Templates.Swap(created.Id, new TemplateSubstitutionInput(null, slot, incline, "Incline dumbbell press", Revision: updated.Revision), default);
        Assert.Single(swapped.AffectedSlots);
        Assert.Equal(incline, swapped.Template.Exercises.Single().ExerciseId);
        Assert.Equal(slot, swapped.Template.Exercises.Single().SlotKey);
    }

    [Fact]
    public async Task Partial_session_swap_keeps_completed_sets_on_original_row()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null),
            new SeedExercise("incline", "Incline dumbbell press", "Chest", "Dumbbell", "", null));
        var bench = await h.ExerciseId("bench"); var incline = await h.ExerciseId("incline");
        var template = await h.Templates.Create(Harness.Template("Push", Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10), Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var planned = session.Exercises.Single();
        var saved = await h.Workouts.Save(session.Id, new SessionInput(null, [new SessionExerciseInput(bench, planned.Name, planned.Note,
            planned.Prescription, [new SetInput(50, 8, 8, true), new SetInput(planned.Sets[1].WeightKg, planned.Sets[1].Reps, null, false)],
            planned.SequenceGroup, planned.Substitutions, planned.LoadModel, planned.Id)], session.Revision, null), default);
        var swapped = await h.Workouts.Swap(session.Id, new SessionSubstitutionInput(planned.Id, incline, "Incline dumbbell press", saved.Revision, null), default);
        Assert.Equal(2, swapped.Exercises.Count);
        var original = swapped.Exercises.Single(e => !e.IsReplacement);
        var replacement = swapped.Exercises.Single(e => e.IsReplacement);
        Assert.Equal(bench, original.ExerciseId);
        Assert.Contains(original.Sets, set => set.Done && set.WeightKg == 50);
        Assert.Equal(incline, replacement.ExerciseId);
        Assert.DoesNotContain(replacement.Sets, set => set.Done);
        var finished = await h.Workouts.Finish(session.Id, swapped.Revision, default);
        Assert.Single(finished.Exercises);
        Assert.Equal(bench, finished.Exercises[0].ExerciseId);
    }

    [Fact]
    public async Task Finish_retention_updates_only_future_slots_in_same_phase()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null),
            new SeedExercise("incline", "Incline dumbbell press", "Chest", "Dumbbell", "", null));
        var bench = await h.ExerciseId("bench"); var incline = await h.ExerciseId("incline");
        var input = new ProgramInput("Two week push", [
            new ProgramWorkoutInput(1, "Push 1", null, null, [Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))], "Block", "Base", 1, false, 1),
            new ProgramWorkoutInput(2, "Push 2", null, null, [Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))], "Block", "Base", 2, false, 1)
        ], null, new DateOnly(2026, 9, 14), "UTC");
        var program = await h.Programs.Create(input, true, null, default);
        var first = program.Workouts.OrderBy(w => w.Week).First(); var second = program.Workouts.OrderBy(w => w.Week).Last();
        var session = await h.Workouts.Start(first.Id, null, default);
        var exercise = session.Exercises.First();
        var saved = await h.Workouts.Save(session.Id, new SessionInput(null, [new SessionExerciseInput(bench, exercise.Name, null, exercise.Prescription,
            [new SetInput(50, 8, 8, true)], null, null, exercise.LoadModel, exercise.Id)], session.Revision, null), default);
        var swapped = await h.Workouts.Swap(session.Id, new SessionSubstitutionInput(exercise.Id, incline, "Incline dumbbell press", saved.Revision, null), default);
        await h.Workouts.Finish(session.Id, swapped.Revision, default, true);
        var refreshed = await h.Programs.Get(program.Id, default);
        Assert.Equal(incline, refreshed.Workouts.Single(w => w.Id == second.Id).Exercises.Single().ExerciseId);
        Assert.Equal(bench, refreshed.Workouts.Single(w => w.Id == first.Id).Exercises.Single().ExerciseId);
    }
}
