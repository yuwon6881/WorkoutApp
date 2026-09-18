using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class WorkoutSessionTests
{
    private static async Task<(Harness h, Guid templateId, Guid benchId)> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        var benchId = await h.ExerciseId("bench");
        var template = await h.Templates.Create(
            Harness.Template("Push", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10), Harness.Set(8, 10))), null, 1, 0, default);
        return (h, template.Id, benchId);
    }

    [Fact] public async Task Only_one_workout_can_be_active_at_a_time()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        await h.Workouts.Start(templateId, null, default);
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Start(templateId, null, default));
        Assert.Equal(409, failure.Status);
    }

    [Fact] public async Task A_started_workout_carries_the_plan_without_marking_anything_complete()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = Assert.Single(session.Exercises);
        Assert.Equal("Bench press", exercise.Name);
        Assert.Equal(2, exercise.Sets.Count);
        Assert.All(exercise.Sets, s => Assert.False(s.Done));
        Assert.All(exercise.Sets, s => Assert.Null(s.Rpe));
        Assert.Equal(0, session.CompletedSets);
        Assert.Null(session.VolumeKg);
    }

    [Fact] public async Task The_next_workout_prefills_a_suggestion_without_completing_it()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var first = await h.Workouts.Start(templateId, null, default);
        await Complete(h, first, 60, 10, 8);
        await h.Workouts.Finish(first.Id, null, default);

        var second = await h.Workouts.Start(templateId, null, default);
        var sets = second.Exercises.Single().Sets;
        // The plan asked for 8-10 at RPE 8 and got all ten of them, so the load moves and the
        // reps go back to the bottom of the range. Nothing is marked as done or rated for the user.
        Assert.Equal(62.5, sets[0].WeightKg);
        Assert.Equal(8, sets[0].Reps);
        Assert.False(sets[0].Done);
        Assert.Null(sets[0].Rpe);
    }

    [Fact] public async Task Finishing_keeps_only_the_sets_that_were_actually_completed()
    {
        var (h, templateId, benchId) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10), Harness.Set(8, 10)],
                [new SetInput(60, 10, 8, true), new SetInput(60, null, null, false)])], session.Revision, null), default);
        var finished = await h.Workouts.Finish(session.Id, null, default);
        var kept = Assert.Single(finished.Exercises).Sets;
        Assert.Single(kept);
        Assert.True(kept[0].Done);
        Assert.Equal(1, finished.CompletedSets);
        Assert.NotNull(finished.FinishedAt);
        Assert.False(finished.Active);
    }

    [Fact] public async Task A_workout_with_no_completed_set_cannot_be_saved()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Finish(session.Id, null, default));
    }

    [Fact] public async Task Volume_counts_known_loads_only_and_never_reads_unknown_as_zero()
    {
        var (h, templateId, benchId) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10), Harness.Set(8, 10)],
                [new SetInput(60, 10, 8, true), new SetInput(null, 10, 8, true)])], session.Revision, null), default);
        var finished = await h.Workouts.Finish(session.Id, null, default);
        Assert.Equal(2, finished.CompletedSets);
        // 60 x 10 only. The unknown-load set is excluded rather than counted as zero.
        Assert.Equal(600, finished.VolumeKg);
    }

    [Fact] public async Task Warmup_rows_are_snapshotted_and_excluded_from_working_volume()
    {
        var h = await Harness.Create();
        await using var _h = h;
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        var benchId = await h.ExerciseId("bench");
        var template = await h.Templates.Create(Harness.Template("Warm-up test", Harness.Exercise(benchId, "Bench press",
            new SetPrescription(10, 10, null, 60, null, null, null, "10", "1 min", null, null, true, "inferred", "inferred", "extracted"),
            Harness.Set(8, 10))), null, 1, 0, default);

        var session = await h.Workouts.Start(template.Id, null, default);
        Assert.True(session.Exercises.Single().Sets[0].Warmup);
        Assert.False(session.Exercises.Single().Sets[1].Warmup);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, session.Exercises.Single().Prescription,
                [new SetInput(20, 10, 7, true, true), new SetInput(60, 10, 8, true, false)])], session.Revision, null), default);
        var finished = await h.Workouts.Finish(session.Id, null, default);
        Assert.Equal(600, finished.VolumeKg);
        Assert.Equal(1, finished.CompletedSets);
        Assert.Equal(1, finished.WarmupSets);
    }

    [Fact] public async Task A_bodyweight_set_at_zero_is_kept_as_a_real_zero()
    {
        var (h, templateId, benchId) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)], [new SetInput(0, 12, 8, true)])], session.Revision, null), default);
        var finished = await h.Workouts.Finish(session.Id, null, default);
        Assert.Equal(0, finished.Exercises.Single().Sets.Single().WeightKg);
        Assert.Equal(0, finished.VolumeKg);
    }

    [Fact] public async Task A_stale_revision_is_refused_instead_of_overwriting_newer_work()
    {
        var (h, templateId, benchId) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        SessionInput Input(int? revision) => new(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)], [new SetInput(60, 10, 8, true)])], revision, null);
        await h.Workouts.Save(session.Id, Input(session.Revision), default);
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Save(session.Id, Input(session.Revision), default));
        Assert.Equal(409, failure.Status);
        Assert.Contains("another device", failure.Message);
    }

    [Fact] public async Task A_replayed_idempotency_id_cannot_write_the_same_change_twice()
    {
        var (h, templateId, benchId) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var replay = Guid.NewGuid();
        SessionInput Input(int revision) => new(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)], [new SetInput(60, 10, 8, true)])], revision, replay);
        var saved = await h.Workouts.Save(session.Id, Input(session.Revision), default);
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Save(session.Id, Input(saved.Revision), default));
        Assert.Equal(409, failure.Status);
    }

    [Fact] public async Task History_keeps_the_name_the_exercise_had_when_it_was_performed()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await Complete(h, session, 60, 10, 8);
        await h.Workouts.Finish(session.Id, null, default);

        // The catalog is renamed afterwards; the finished session must not follow it.
        await h.Seed(new SeedExercise("bench", "Renamed bench press", "Chest", "Barbell", "Cue", null));
        var history = await h.Workouts.History(0, 10, default);
        Assert.Equal("Bench press", history.Sessions.Single().Exercises.Single().Name);
    }

    [Fact] public async Task Discarding_an_active_workout_removes_it_entirely()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Discard(session.Id, default);
        Assert.Null(await h.Workouts.Active(default));
        Assert.Equal(0, await h.Db.Sets.CountAsync());
        Assert.Equal(0, await h.Db.SessionExercises.CountAsync());
    }

    [Fact] public async Task A_saved_workout_is_deleted_from_history_rather_than_discarded()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await Complete(h, session, 60, 10, 8);
        await h.Workouts.Finish(session.Id, null, default);
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Discard(session.Id, default));
        Assert.Equal(409, failure.Status);
        await h.Workouts.DeleteFromHistory(session.Id, default);
        Assert.Equal(0, (await h.Workouts.History(0, 10, default)).Total);
    }

    private static async Task Complete(Harness h, SessionView session, double weight, int reps, double rpe)
    {
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                exercise.Sets.Select(_ => new SetInput(weight, reps, rpe, true)).ToList())], session.Revision, null), default);
    }
}
