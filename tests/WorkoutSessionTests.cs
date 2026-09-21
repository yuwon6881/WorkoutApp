using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using Workout.Api.Data;
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

    [Fact] public async Task A_set_patch_updates_only_the_changed_set_and_honors_session_revision()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var set = session.Exercises.Single().Sets.First();
        using var payload = JsonDocument.Parse($"{{\"revision\":{session.Revision},\"weightKg\":65,\"reps\":9,\"rpe\":8,\"done\":true,\"mutationId\":\"{Guid.NewGuid()}\"}}");
        var patched = await h.Workouts.PatchSet(session.Id, set.Id, payload.RootElement.Clone(), default);
        var changed = patched.Exercises.Single().Sets.Single(item => item.Id == set.Id);
        Assert.Equal(65, changed.WeightKg);
        Assert.Equal(9, changed.Reps);
        Assert.True(changed.Done);
        Assert.Equal(session.Revision + 1, patched.Revision);

        using var stale = JsonDocument.Parse($"{{\"revision\":{session.Revision},\"reps\":10}} ");
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.PatchSet(session.Id, set.Id, stale.RootElement.Clone(), default));
        Assert.Equal(409, failure.Status);
    }

    [Fact] public async Task Replaying_a_set_patch_acknowledges_before_the_stale_revision_check()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = Assert.Single(session.Exercises);
        var firstSet = exercise.Sets[0];
        var secondSet = exercise.Sets[1];
        var firstMutation = Guid.NewGuid();
        using var firstPayload = JsonDocument.Parse($"{{\"revision\":{session.Revision},\"reps\":9,\"mutationId\":\"{firstMutation}\"}}");
        var first = await h.Workouts.PatchSet(session.Id, firstSet.Id, firstPayload.RootElement.Clone(), default);

        using var secondPayload = JsonDocument.Parse($"{{\"revision\":{first.Revision},\"reps\":10,\"mutationId\":\"{Guid.NewGuid()}\"}}");
        var latest = await h.Workouts.PatchSet(session.Id, secondSet.Id, secondPayload.RootElement.Clone(), default);

        // Object property order does not change the request fingerprint, and the old revision
        // is intentionally retained because this is the exact request whose response was lost.
        using var retryPayload = JsonDocument.Parse($"{{\"mutationId\":\"{firstMutation}\",\"reps\":9,\"revision\":{session.Revision}}}");
        var replay = await h.Workouts.PatchSet(session.Id, firstSet.Id, retryPayload.RootElement.Clone(), default);
        Assert.Equal(latest.Revision, replay.Revision);
        Assert.Equal(9, replay.Exercises.Single().Sets[0].Reps);
        Assert.Equal(10, replay.Exercises.Single().Sets[1].Reps);

        using var reusedId = JsonDocument.Parse($"{{\"revision\":{session.Revision},\"reps\":8,\"mutationId\":\"{firstMutation}\"}}");
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.PatchSet(session.Id, firstSet.Id, reusedId.RootElement.Clone(), default));
        Assert.Equal(409, failure.Status);
    }

    [Fact] public async Task Replaying_a_full_session_save_does_not_replace_newer_session_state()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = Assert.Single(session.Exercises);
        var input = new SessionInput("First note",
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                exercise.Sets.Select(set => new SetInput(set.WeightKg, set.Reps, set.Rpe, set.Done, set.Warmup,
                    set.ResistanceMode, set.Id)).ToList(),
                SequenceGroup: exercise.SequenceGroup, Substitutions: [], LoadModel: exercise.LoadModel, Id: exercise.Id,
                SourceTemplateExerciseId: exercise.SourceTemplateExerciseId, SourceSlotKey: exercise.SourceSlotKey,
                SourcePhaseId: exercise.SourcePhaseId, SourcePage: exercise.SourcePage)], session.Revision, Guid.NewGuid());
        var saved = await h.Workouts.Save(session.Id, input, default);

        var set = saved.Exercises.Single().Sets[0];
        using var newerPayload = JsonDocument.Parse($"{{\"revision\":{saved.Revision},\"reps\":9,\"mutationId\":\"{Guid.NewGuid()}\"}}");
        var latest = await h.Workouts.PatchSet(session.Id, set.Id, newerPayload.RootElement.Clone(), default);

        var replay = await h.Workouts.Save(session.Id, input, default);
        Assert.Equal(latest.Revision, replay.Revision);
        Assert.Equal("First note", replay.Note);
        Assert.Equal(9, replay.Exercises.Single().Sets[0].Reps);
    }

    [Fact] public async Task Pause_and_resume_keep_ordered_durable_timing_and_exact_retries()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var startedAt = DateTime.UtcNow.AddHours(-1);
        var row = await h.Db.Workouts.SingleAsync(workout => workout.Id == session.Id);
        row.StartedAt = startedAt;
        await h.Db.SaveChangesAsync();

        var pausedAt = startedAt.AddMinutes(20);
        var pauseInput = new WorkoutTimingInput(session.Revision, Guid.NewGuid(), new DateTimeOffset(pausedAt, TimeSpan.Zero));
        var paused = await h.Workouts.Pause(session.Id, pauseInput, default);
        Assert.Equal(pausedAt, paused.PausedAt);
        Assert.Equal(0, paused.PausedSeconds);

        var replayedPause = await h.Workouts.Pause(session.Id, pauseInput, default);
        Assert.Equal(paused.Revision, replayedPause.Revision);

        var resumedAt = pausedAt.AddSeconds(30);
        var resumeInput = new WorkoutTimingInput(paused.Revision, Guid.NewGuid(), new DateTimeOffset(resumedAt, TimeSpan.Zero));
        var resumed = await h.Workouts.Resume(session.Id, resumeInput, default);
        Assert.Null(resumed.PausedAt);
        Assert.Equal(30, resumed.PausedSeconds);

        var outOfOrder = new WorkoutTimingInput(resumed.Revision, Guid.NewGuid(), new DateTimeOffset(pausedAt.AddSeconds(10), TimeSpan.Zero));
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Pause(session.Id, outOfOrder, default));
        Assert.Equal(409, failure.Status);
    }

    [Fact] public async Task Finish_uses_the_client_time_and_closes_an_open_pause_once()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var startedAt = DateTime.UtcNow.AddHours(-2);
        var row = await h.Db.Workouts.SingleAsync(workout => workout.Id == session.Id);
        row.StartedAt = startedAt;
        await h.Db.SaveChangesAsync();
        var current = await h.Workouts.Get(session.Id, default);
        await Complete(h, current, 60, 10, 8);
        current = await h.Workouts.Get(session.Id, default);

        var pausedAt = DateTime.UtcNow.AddMinutes(-30);
        var paused = await h.Workouts.Pause(session.Id,
            new WorkoutTimingInput(current.Revision, Guid.NewGuid(), new DateTimeOffset(pausedAt, TimeSpan.Zero)), default);
        var finishedAt = pausedAt.AddMinutes(20);
        var finishId = Guid.NewGuid();
        var finished = await h.Workouts.Finish(session.Id, paused.Revision, default, false, finishId,
            new DateTimeOffset(finishedAt, TimeSpan.Zero));

        Assert.Equal(finishedAt, finished.FinishedAt);
        Assert.Null(finished.PausedAt);
        Assert.Equal(20 * 60, finished.PausedSeconds);

        var replay = await h.Workouts.Finish(session.Id, paused.Revision, default, false, finishId,
            new DateTimeOffset(finishedAt, TimeSpan.Zero));
        Assert.Equal(finished.Revision, replay.Revision);
        Assert.Equal(finishedAt, replay.FinishedAt);
        Assert.Equal(20 * 60, replay.PausedSeconds);
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
            new SetPrescription(10, 10, null, 60, null, null, null, "10", "1 min", null, true, "inferred", "inferred", "extracted"),
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

    [Fact] public async Task Activity_marks_completed_sessions_on_finish_date_and_active_sessions_on_start_date()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var active = await h.Workouts.Start(templateId, "Morning push", default);

        var activity = await h.Workouts.Activity(today.AddDays(-7), today.AddDays(7), "UTC", default);
        var activeItem = Assert.Single(activity);
        Assert.Equal(active.Id, activeItem.Id);
        Assert.Equal("Push", activeItem.Name);
        Assert.Equal("in_progress", activeItem.Status);
        Assert.Equal(DateOnly.FromDateTime(active.StartedAt), activeItem.Date);

        await Complete(h, active, 60, 10, 8);
        var finished = await h.Workouts.Finish(active.Id, null, default);

        activity = await h.Workouts.Activity(today.AddDays(-7), today.AddDays(7), "UTC", default);
        var finishedItem = Assert.Single(activity);
        Assert.Equal(finished.Id, finishedItem.Id);
        Assert.Equal("Push", finishedItem.Name);
        Assert.Equal("completed", finishedItem.Status);
        Assert.Equal(DateOnly.FromDateTime(finished.FinishedAt!.Value), finishedItem.Date);
    }

    [Fact] public async Task Activity_filters_by_date_range_and_preserves_tenant_isolation()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var s1 = await h.Workouts.Start(templateId, "Push 1", default);
        await Complete(h, s1, 60, 10, 8);
        await h.Workouts.Finish(s1.Id, null, default);

        var pastActivity = await h.Workouts.Activity(today.AddDays(-10), today.AddDays(-1), "UTC", default);
        Assert.Empty(pastActivity);

        var todayActivity = await h.Workouts.Activity(today, today, "UTC", default);
        Assert.Single(todayActivity);

        var h2 = await Harness.Create();
        await h2.SignIn("other-user");
        var h2Activity = await h2.Workouts.Activity(today.AddDays(-1), today.AddDays(1), "UTC", default);
        Assert.Empty(h2Activity);
    }

    [Fact] public async Task Activity_localizes_timestamps_with_positive_and_negative_utc_offsets()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;

        var s = await h.Workouts.Start(templateId, "Night push", default);
        await Complete(h, s, 60, 10, 8);
        var finished = await h.Workouts.Finish(s.Id, null, default);

        // Set finishedAt to 23:30 UTC on 2026-06-15
        var entity = await h.Db.Workouts.SingleAsync(w => w.Id == finished.Id);
        entity.FinishedAt = new DateTime(2026, 6, 15, 23, 30, 0, DateTimeKind.Utc);
        await h.Db.SaveChangesAsync();

        // In Asia/Tokyo (UTC+9), 23:30 UTC on June 15 is 08:30 on June 16
        var tokyoJune16 = await h.Workouts.Activity(new DateOnly(2026, 6, 16), new DateOnly(2026, 6, 16), "Asia/Tokyo", default);
        var tokyoItem = Assert.Single(tokyoJune16);
        Assert.Equal(new DateOnly(2026, 6, 16), tokyoItem.Date);

        var tokyoJune15 = await h.Workouts.Activity(new DateOnly(2026, 6, 15), new DateOnly(2026, 6, 15), "Asia/Tokyo", default);
        Assert.Empty(tokyoJune15);

        // In America/New_York (UTC-4 in summer), 23:30 UTC on June 15 is 19:30 on June 15
        var nyJune15 = await h.Workouts.Activity(new DateOnly(2026, 6, 15), new DateOnly(2026, 6, 15), "America/New_York", default);
        var nyItem = Assert.Single(nyJune15);
        Assert.Equal(new DateOnly(2026, 6, 15), nyItem.Date);

        var nyJune16 = await h.Workouts.Activity(new DateOnly(2026, 6, 16), new DateOnly(2026, 6, 16), "America/New_York", default);
        Assert.Empty(nyJune16);
    }

    [Fact] public async Task Activity_localizes_active_session_started_at_across_midnight()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;

        var active = await h.Workouts.Start(templateId, "Midnight push", default);
        var entity = await h.Db.Workouts.SingleAsync(w => w.Id == active.Id);
        entity.StartedAt = new DateTime(2026, 6, 15, 23, 30, 0, DateTimeKind.Utc);
        await h.Db.SaveChangesAsync();

        // Tokyo: June 16
        var tokyo = await h.Workouts.Activity(new DateOnly(2026, 6, 16), new DateOnly(2026, 6, 16), "Asia/Tokyo", default);
        Assert.Equal(new DateOnly(2026, 6, 16), Assert.Single(tokyo).Date);
        Assert.Equal("in_progress", tokyo[0].Status);

        // New York: June 15
        var ny = await h.Workouts.Activity(new DateOnly(2026, 6, 15), new DateOnly(2026, 6, 15), "America/New_York", default);
        Assert.Equal(new DateOnly(2026, 6, 15), Assert.Single(ny).Date);
        Assert.Equal("in_progress", ny[0].Status);
    }

    [Fact] public async Task Activity_handles_daylight_saving_transition_boundaries()
    {
        var (h, templateId, _) = await Ready();
        await using var _h = h;

        // In US Eastern time, DST starts second Sunday in March (March 8, 2026).
        // Before transition (EST = UTC-5): March 7, 2026 at 04:30 UTC -> March 6 at 23:30 EST
        var s1 = await h.Workouts.Start(templateId, "Pre-DST", default);
        await Complete(h, s1, 60, 10, 8);
        await h.Workouts.Finish(s1.Id, null, default);
        var e1 = await h.Db.Workouts.SingleAsync(w => w.Id == s1.Id);
        e1.FinishedAt = new DateTime(2026, 3, 7, 4, 30, 0, DateTimeKind.Utc);

        // After transition (EDT = UTC-4): March 9, 2026 at 03:30 UTC -> March 8 at 23:30 EDT
        // Start another session for user
        var s2 = new WorkoutSession
        {
            UserId = e1.UserId,
            Name = "Post-DST",
            StartedAt = new DateTime(2026, 3, 9, 2, 0, 0, DateTimeKind.Utc),
            FinishedAt = new DateTime(2026, 3, 9, 3, 30, 0, DateTimeKind.Utc)
        };
        h.Db.Workouts.Add(s2);
        await h.Db.SaveChangesAsync();

        var estItems = await h.Workouts.Activity(new DateOnly(2026, 3, 6), new DateOnly(2026, 3, 6), "America/New_York", default);
        Assert.Equal(new DateOnly(2026, 3, 6), Assert.Single(estItems).Date);

        var edtItems = await h.Workouts.Activity(new DateOnly(2026, 3, 8), new DateOnly(2026, 3, 8), "America/New_York", default);
        Assert.Equal(new DateOnly(2026, 3, 8), Assert.Single(edtItems).Date);
    }

    [Fact] public async Task Activity_rejects_missing_or_invalid_time_zones()
    {
        var (h, _, _) = await Ready();
        await using var _h = h;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var exMissing = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Activity(today, today, null, default));
        Assert.Equal(400, exMissing.Status);

        var exEmpty = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Activity(today, today, "   ", default));
        Assert.Equal(400, exEmpty.Status);

        var exInvalid = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Activity(today, today, "Moon/Mare_Tranquillitatis", default));
        Assert.Equal(400, exInvalid.Status);
    }
}
