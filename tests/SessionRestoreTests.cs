using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Restore default (one exercise) and Restore program defaults (the whole workout) put the plan
/// back while keeping every logged set.
public sealed class SessionRestoreTests
{
    private static SetPrescription Warmup() => Harness.Set(5, 5, null) with { Warmup = true };

    private static SessionExerciseInput Input(SessionExerciseView exercise, List<SetPrescription> prescription, List<SetInput> sets)
        => new(exercise.ExerciseId, exercise.Name, exercise.Note, prescription, sets, exercise.SequenceGroup, exercise.Substitutions,
            exercise.LoadModel, exercise.Id, exercise.SourceTemplateExerciseId, exercise.SourceSlotKey, exercise.SourcePhaseId);

    private static SetInput Keep(SetView set, bool? done = null, bool? warmup = null, int? reps = null)
        => new(set.WeightKg, reps ?? set.Reps, set.Rpe, done ?? set.Done, warmup ?? set.Warmup, set.ResistanceMode, set.Id);

    [Fact]
    public void Plan_restore_keeps_logged_sets_resets_unlogged_ones_and_drops_unlogged_extras()
    {
        var baseline = new SessionExerciseBaseline(null, "Bench", "", Json.Write(new List<SetPrescription> { Warmup(), Harness.Set(8, 10) }),
            "", "[]", LoadModels.External, "", [
                new BaselineSetSnapshot(0, null, null, 5, null, true, "", ResistanceModes.Bodyweight, null),
                new BaselineSetSnapshot(1, 1, 60, 8, null, false, "{}", ResistanceModes.External, null)
            ]);
        var logged = new CompletedSet { Position = 0, Done = true, WeightKg = 40, Reps = 10, Rpe = 7, Warmup = false };
        var edited = new CompletedSet { Position = 1, Done = false, WeightKg = 80, Reps = 3 };
        var extraLogged = new CompletedSet { Position = 2, Done = true, WeightKg = 70, Reps = 6 };
        var extraEmpty = new CompletedSet { Position = 3, Done = false };

        Assert.True(SessionPlanRestore.PlanDiffers(baseline, Json.Write(new List<SetPrescription> { Harness.Set(8, 10), Harness.Set(8, 10) }),
            [logged, edited]));
        var result = SessionPlanRestore.Apply(baseline, [logged, edited, extraLogged, extraEmpty]);
        var rows = SessionPlanRestore.ApplyTo(result, Guid.NewGuid(), Guid.NewGuid(), _ => { });

        Assert.Equal([extraEmpty], result.Removed);
        Assert.Equal(3, result.Prescription.Count);
        Assert.True(result.Prescription[0].Warmup);
        Assert.False(result.Prescription[2].Warmup);
        Assert.Equal([logged, edited, extraLogged], rows);
        Assert.True(logged.Warmup);
        Assert.Equal((40d, 10, (double?)null), (logged.WeightKg!.Value, logged.Reps!.Value, logged.Rpe));
        Assert.Equal((60d, 8, "{}"), (edited.WeightKg!.Value, edited.Reps!.Value, edited.SuggestionJson));
        Assert.Equal([null, 1, 2], rows.Select(row => row.WorkingSetOrdinal));
    }

    [Fact]
    public async Task Restore_default_returns_the_plan_and_keeps_logged_sets()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null));
        var bench = await h.ExerciseId("bench");
        var template = await h.Templates.Create(Harness.Template("Push",
            Harness.Exercise(bench, "Barbell bench press", Warmup(), Harness.Set(8, 10), Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var planned = session.Exercises.Single();
        Assert.False(planned.CanRestore);

        // The lifter logs the warm-up, turns the last set into myo-reps, and adds a set.
        var prescription = planned.Prescription.ToList();
        prescription[2] = prescription[2] with { Notes = "Myo-reps" };
        prescription.Add(prescription[1]);
        var edited = await h.Workouts.Save(session.Id, new SessionInput(null, [Input(planned, prescription, [
            Keep(planned.Sets[0], done: true, reps: 6), Keep(planned.Sets[1]), Keep(planned.Sets[2]),
            new SetInput(null, null, null, false)])], session.Revision, null), default);
        var changed = edited.Exercises.Single();
        Assert.True(changed.CanRestore);

        var restored = await h.Workouts.RestoreExercise(session.Id, new SessionExerciseRestoreInput(changed.Id, edited.Revision, Guid.NewGuid()), default);
        var exercise = restored.Exercises.Single();
        Assert.False(exercise.CanRestore);
        Assert.Equal(3, exercise.Sets.Count);
        Assert.Null(exercise.Prescription[2].Notes);
        Assert.True(exercise.Sets[0].Done);
        Assert.Equal(6, exercise.Sets[0].Reps);

        // Nothing left to restore: a repeated tap changes nothing.
        var again = await h.Workouts.RestoreExercise(session.Id, new SessionExerciseRestoreInput(exercise.Id, restored.Revision, Guid.NewGuid()), default);
        Assert.Equal(restored.Revision, again.Revision);
    }

    [Fact]
    public async Task A_swapped_exercise_with_logged_sets_keeps_the_swap_but_returns_its_plan()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null),
            new SeedExercise("incline", "Incline dumbbell press", "Chest", "Dumbbell", "", null));
        var bench = await h.ExerciseId("bench"); var incline = await h.ExerciseId("incline");
        var template = await h.Templates.Create(Harness.Template("Push", Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var swapped = await h.Workouts.Swap(session.Id, new SessionSubstitutionInput(session.Exercises[0].Id, incline, "Incline dumbbell press", session.Revision, null), default);
        var exercise = swapped.Exercises.Single();
        var logged = await h.Workouts.Save(session.Id, new SessionInput(null, [Input(exercise, [.. exercise.Prescription, exercise.Prescription[0]], [
            new SetInput(20, 9, null, true, Id: exercise.Sets[0].Id), new SetInput(null, null, null, false)])], swapped.Revision, null), default);
        Assert.True(logged.Exercises.Single().CanRestore);

        var restored = await h.Workouts.RestoreExercise(session.Id, new SessionExerciseRestoreInput(exercise.Id, logged.Revision), default);
        var result = restored.Exercises.Single();
        Assert.Equal(incline, result.ExerciseId);
        Assert.Single(result.Sets);
        Assert.Equal(9, result.Sets[0].Reps);
        Assert.False(result.CanRestore);
    }

    [Fact]
    public async Task Restore_program_defaults_brings_back_removed_exercises_and_drops_unlogged_additions()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null),
            new SeedExercise("fly", "Cable fly", "Chest", "Cable", "", null),
            new SeedExercise("dip", "Dip", "Chest", "Bodyweight", "", null));
        var bench = await h.ExerciseId("bench"); var fly = await h.ExerciseId("fly"); var dip = await h.ExerciseId("dip");
        var template = await h.Templates.Create(Harness.Template("Push",
            Harness.Exercise(bench, "Barbell bench press", Harness.Set(8, 10)),
            Harness.Exercise(fly, "Cable fly", Harness.Set(12, 15), Harness.Set(12, 15))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var first = session.Exercises[0];

        // Fly is removed, an unlogged dip is added and the bench gains a logged extra set.
        var edited = await h.Workouts.Save(session.Id, new SessionInput(null, [
            Input(first, [.. first.Prescription, first.Prescription[0]], [Keep(first.Sets[0]), new SetInput(50, 8, null, true)]),
            new SessionExerciseInput(dip, "Dip", null, [Harness.Set(8, 12)], [new SetInput(null, null, null, false)])
        ], session.Revision, null), default);
        Assert.Equal(["Barbell bench press", "Dip"], edited.Exercises.Select(e => e.Name));

        var idempotency = Guid.NewGuid();
        var restored = await h.Workouts.RestoreWorkout(session.Id, new SessionRestoreInput(edited.Revision, idempotency), default);
        Assert.Equal(["Barbell bench press", "Cable fly"], restored.Exercises.Select(e => e.Name));
        var bench2 = restored.Exercises[0];
        Assert.Equal(2, bench2.Sets.Count);
        Assert.True(bench2.Sets[1].Done);
        var flyRow = restored.Exercises[1];
        Assert.Equal(2, flyRow.Sets.Count);
        Assert.False(flyRow.CanRestore);
        Assert.NotEmpty((await h.Db.SessionExercises.SingleAsync(e => e.Id == flyRow.Id)).BaselineJson);

        var replay = await h.Workouts.RestoreWorkout(session.Id, new SessionRestoreInput(edited.Revision, idempotency), default);
        Assert.Equal(restored.Revision, replay.Revision);
        var stale = await Assert.ThrowsAsync<DomainException>(() =>
            h.Workouts.RestoreWorkout(session.Id, new SessionRestoreInput(edited.Revision, Guid.NewGuid()), default));
        Assert.Equal(409, stale.Status);
    }

    [Fact]
    public async Task A_freestyle_workout_has_no_plan_to_restore()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var session = await h.Workouts.Start(null, "Freestyle", default);
        var refused = await Assert.ThrowsAsync<DomainException>(() =>
            h.Workouts.RestoreWorkout(session.Id, new SessionRestoreInput(session.Revision), default));
        Assert.Equal(409, refused.Status);
    }
}
