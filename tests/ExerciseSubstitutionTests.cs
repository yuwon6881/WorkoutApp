using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ExerciseSubstitutionTests
{
    [Fact]
    public async Task Substitution_candidates_rank_shared_secondary_muscles_after_imported_alternatives()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("press", "Barbell Press", "Chest", "Barbell", "", null, SecondaryMuscles: ["Triceps", "Shoulders"]),
            new SeedExercise("press-match", "Incline Press", "Chest", "Dumbbell", "", null, SecondaryMuscles: ["Triceps", "Shoulders"]),
            new SeedExercise("press-primary", "Machine Press", "Chest", "Machine", "", null, SecondaryMuscles: ["Core"]),
            new SeedExercise("row", "Cable Row", "Back", "Cable", "", null, SecondaryMuscles: ["Biceps"]));

        var source = await h.ExerciseId("press");
        var rows = await h.Catalog.Substitutions(source, null, [], null, default);

        Assert.Equal("Incline Press", rows[0].Name);
        Assert.Equal("Machine Press", rows[1].Name);
        Assert.DoesNotContain(rows.Take(2), row => row.Name == "Cable Row");
        Assert.Equal(["Triceps", "Shoulders"], rows[0].SecondaryMuscles);
    }

    [Fact]
    public async Task Candidates_keep_matched_imports_first_and_discard_unmatched_or_placeholders()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", ["flat bench"], 2.5, Workout.Api.Domain.LoadModels.External, "horizontal_push"),
            new SeedExercise("incline", "Incline dumbbell press", "Chest", "Dumbbell", "", null, 2.5, Workout.Api.Domain.LoadModels.External, "horizontal_push"),
            new SeedExercise("curl", "Dumbbell curl", "Biceps", "Dumbbell", "", null, 2.5, Workout.Api.Domain.LoadModels.External, "elbow_flexion"));
        var bench = await h.ExerciseId("bench");
        var incline = await h.ExerciseId("incline");
        var rows = await h.Catalog.Substitutions(bench, null, ["Incline dumbbell press", "Mystery press", "N/A", "See Notes"], null, default);
        Assert.Equal("Incline dumbbell press", rows[0].Name);
        Assert.Equal(incline, rows[0].ExerciseId);
        Assert.Equal("imported", rows[0].Source);
        Assert.DoesNotContain(rows, r => r.Name == "Mystery press" || r.Name == "N/A" || r.Name == "See Notes");
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
    public async Task Swap_after_completing_sets_is_rejected()
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

        var ex = await Assert.ThrowsAsync<DomainException>(() =>
            h.Workouts.Swap(session.Id, new SessionSubstitutionInput(planned.Id, incline, "Incline dumbbell press", saved.Revision, null), default));
        Assert.Equal(409, ex.Status);
        Assert.Contains("Cannot swap an exercise after completing sets", ex.Message);
    }

    [Fact]
    public async Task Swap_and_restore_active_exercise_restores_original_and_clears_retention()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null),
            new SeedExercise("incline", "Incline dumbbell press", "Chest", "Dumbbell", "", null));
        var bench = await h.ExerciseId("bench"); var incline = await h.ExerciseId("incline");
        var template = await h.Templates.Create(Harness.Template("Push", Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var planned = session.Exercises.Single();
        Assert.False(planned.CanRestore);

        var swapped = await h.Workouts.Swap(session.Id, new SessionSubstitutionInput(planned.Id, incline, "Incline dumbbell press", session.Revision, null), default);
        var swappedEx = swapped.Exercises.Single();
        Assert.True(swappedEx.CanRestore);
        Assert.Equal(incline, swappedEx.ExerciseId);

        var restored = await h.Workouts.RestoreExercise(session.Id, new SessionExerciseRestoreInput(swappedEx.Id, swapped.Revision), default);
        var restoredEx = restored.Exercises.Single();
        Assert.False(restoredEx.CanRestore);
        Assert.Equal(bench, restoredEx.ExerciseId);
        Assert.Equal("Barbell bench press", restoredEx.Name);
    }

    [Fact]
    public async Task Older_session_without_snapshot_is_unrestorable()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null));
        var bench = await h.ExerciseId("bench");
        var template = await h.Templates.Create(Harness.Template("Push", Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var exercise = await h.Db.SessionExercises.SingleAsync(e => e.SessionId == session.Id);
        exercise.BaselineJson = "";
        exercise.IsReplacement = true;
        await h.Db.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<DomainException>(() =>
            h.Workouts.RestoreExercise(session.Id, new SessionExerciseRestoreInput(exercise.Id, session.Revision), default));
        Assert.Equal(409, ex.Status);
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
            new ProgramWorkoutInput(1, "Push 1", null, null, [Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))], "Block", "Base", 1, false),
            new ProgramWorkoutInput(2, "Push 2", null, null, [Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))], "Block", "Base", 2, false)
        ]);
        var program = await h.Programs.Create(input, true, null, default);
        var first = program.Workouts.OrderBy(w => w.Week).First(); var second = program.Workouts.OrderBy(w => w.Week).Last();
        var session = await h.Workouts.Start(first.Id, null, default);
        var exercise = session.Exercises.First();

        var swapped = await h.Workouts.Swap(session.Id, new SessionSubstitutionInput(exercise.Id, incline, "Incline dumbbell press", session.Revision, null), default);
        var swappedExercise = swapped.Exercises.Single();

        var saved = await h.Workouts.Save(session.Id, new SessionInput(null, [new SessionExerciseInput(incline, swappedExercise.Name, null, swappedExercise.Prescription,
            [new SetInput(50, 8, 8, true)], null, null, swappedExercise.LoadModel, swappedExercise.Id)], swapped.Revision, null), default);

        await h.Workouts.Finish(session.Id, saved.Revision, default, true);
        var refreshed = await h.Programs.Get(program.Id, default);
        Assert.Equal(incline, refreshed.Workouts.Single(w => w.Id == second.Id).Exercises.Single().ExerciseId);
        Assert.Equal(bench, refreshed.Workouts.Single(w => w.Id == first.Id).Exercises.Single().ExerciseId);
    }

    [Fact]
    public async Task Template_standalone_restore_and_exercise_restore()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null),
            new SeedExercise("incline", "Incline dumbbell press", "Chest", "Dumbbell", "", null));
        var bench = await h.ExerciseId("bench"); var incline = await h.ExerciseId("incline");
        var created = await h.Templates.Create(Harness.Template("Push", Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))), null, 1, 0, default);
        var slot = created.Exercises.Single().SlotKey;

        var swapped = await h.Templates.Swap(created.Id, new TemplateSubstitutionInput(null, slot, incline, "Incline dumbbell press", Revision: created.Revision), default);
        var swappedEx = swapped.Template.Exercises.Single();
        Assert.True(swappedEx.CanRestore);
        Assert.True(swappedEx.IsModified);
        Assert.True(swapped.Template.CanRestore);

        await h.Templates.RestoreSubstitution(created.Id, new TemplateSubstitutionRestoreInput(swappedEx.Id, null, Scope: "slot", Revision: swapped.Template.Revision), default);
        var restoredTemplate = await h.Templates.Get(created.Id, default);
        var restoredEx = restoredTemplate.Exercises.Single();
        Assert.Equal(bench, restoredEx.ExerciseId);
        Assert.False(restoredEx.CanRestore);

        // Whole template restore
        var modified = await h.Templates.Update(created.Id, new TemplateInput("Modified Push", "New Focus", null,
            [new TemplateExerciseInput(incline, "Incline dumbbell press", null, [Harness.Set(6, 8)], SlotKey: slot)], restoredTemplate.Revision, null), default);
        Assert.True(modified.CanRestore);

        var fullRestored = await h.Templates.RestoreTemplate(created.Id, modified.Revision, null, default);
        Assert.Equal("Push", fullRestored.Name);
        Assert.Equal(bench, fullRestored.Exercises.Single().ExerciseId);
    }

    [Fact]
    public async Task Program_exercise_swap_restore_honors_phase_scope_and_exclusions()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null),
            new SeedExercise("incline", "Incline dumbbell press", "Chest", "Dumbbell", "", null));
        var bench = await h.ExerciseId("bench"); var incline = await h.ExerciseId("incline");
        var input = new ProgramInput("Three week push", [
            new ProgramWorkoutInput(1, "Push 1", null, null, [Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))], "Block", "Base", 1, false),
            new ProgramWorkoutInput(2, "Push 2", null, null, [Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))], "Block", "Base", 2, false),
            new ProgramWorkoutInput(3, "Push 3", null, null, [Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))], "Block", "Base", 3, false)
        ]);
        var program = await h.Programs.Create(input, true, null, default);
        var workouts = program.Workouts.OrderBy(w => w.Week).ToList();
        var w1 = workouts[0]; var w2 = workouts[1]; var w3 = workouts[2];

        // Finish w1
        var s1 = await h.Workouts.Start(w1.Id, null, default);
        var ex1 = s1.Exercises.Single();
        var saved1 = await h.Workouts.Save(s1.Id, new SessionInput(null, [new SessionExerciseInput(bench, ex1.Name, null, ex1.Prescription,
            [new SetInput(50, 8, 8, true)], null, null, ex1.LoadModel, ex1.Id)], s1.Revision, null), default);
        await h.Workouts.Finish(s1.Id, saved1.Revision, default);

        // Skip w2
        await h.Programs.Skip(program.Id, w2.Id, default);

        // Swap w3 across phase
        var slotKey = w3.Exercises.Single().SlotKey;
        var swapRes = await h.Templates.Swap(w3.Id, new TemplateSubstitutionInput(null, slotKey, incline, "Incline dumbbell press", Scope: "phase", Revision: w3.Revision), default);
        Assert.Contains(w3.Id, swapRes.AffectedSlots.Select(s => s.TemplateId));
        Assert.DoesNotContain(w1.Id, swapRes.AffectedSlots.Select(s => s.TemplateId));
        Assert.DoesNotContain(w2.Id, swapRes.AffectedSlots.Select(s => s.TemplateId));

        // Restore w3 across phase
        var refreshedW3 = await h.Templates.Get(w3.Id, default);
        var restoreRes = await h.Templates.RestoreSubstitution(w3.Id, new TemplateSubstitutionRestoreInput(null, slotKey, Scope: "phase", Revision: refreshedW3.Revision), default);
        Assert.Contains(w3.Id, restoreRes.AffectedSlots.Select(s => s.TemplateId));
        Assert.DoesNotContain(w1.Id, restoreRes.AffectedSlots.Select(s => s.TemplateId));
        Assert.DoesNotContain(w2.Id, restoreRes.AffectedSlots.Select(s => s.TemplateId));

        var finalW3 = await h.Templates.Get(w3.Id, default);
        Assert.Equal(bench, finalW3.Exercises.Single().ExerciseId);
    }
}
