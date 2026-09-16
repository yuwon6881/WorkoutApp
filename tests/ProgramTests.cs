using Workout.Api.Domain;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class ProgramTests
{
    private static ProgramInput TwoWeeks(Guid benchId) => new("Starting strength", "A two-week block",
    [
        new ProgramWorkoutInput(1, "Week 1 Day A", "Push", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], Weekday: 1),
        new ProgramWorkoutInput(1, "Week 1 Day B", "Pull", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], Weekday: 3),
        new ProgramWorkoutInput(2, "Week 2 Day A", "Push", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(6, 8))], Weekday: 1)
    ], null, new DateOnly(2026, 9, 14));

    private static async Task<(Harness h, Guid benchId)> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        return (h, await h.ExerciseId("bench"));
    }

    [Fact] public async Task A_program_keeps_its_weeks_and_ordering()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        Assert.Equal(2, program.Weeks);
        Assert.Equal(3, program.Workouts.Count);
        Assert.Equal(["Week 1 Day A", "Week 1 Day B", "Week 2 Day A"], program.Workouts.Select(w => w.Name));
        Assert.Equal([0, 1, 0], program.Workouts.Select(w => w.Position));
        Assert.True(program.Active);
    }

    [Fact] public async Task Consecutive_phases_stay_inside_one_program_with_relative_weeks_and_durations()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(new ProgramInput("Two phases", null,
            [
                new ProgramWorkoutInput(1, "Base A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block 1", "Base", 1, false, 1, 12),
                new ProgramWorkoutInput(2, "Base A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block 1", "Base", 2, false, 1, 18),
                new ProgramWorkoutInput(3, "Peak A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(5, 8))], "Block 1", "Peak", 1, false, 1, 24),
                new ProgramWorkoutInput(4, "Peak A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(5, 8))], "Block 1", "Peak", 2, false, 1, 30)
            ], null), false, null, default);

        Assert.Equal(2, program.Phases!.Count);
        Assert.Equal(("Base", 1, 2, 2), (program.Phases[0].Name, program.Phases[0].WeekFrom, program.Phases[0].WeekTo, program.Phases[0].DurationWeeks));
        Assert.Equal(("Peak", 3, 4, 2), (program.Phases[1].Name, program.Phases[1].WeekFrom, program.Phases[1].WeekTo, program.Phases[1].DurationWeeks));
        Assert.Equal([12, 18, 24, 30], program.Workouts.Select(workout => workout.SourcePage));
    }

    [Fact] public async Task Only_one_program_is_active_and_a_second_one_waits()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var first = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        var second = await h.Programs.Create(TwoWeeks(benchId) with { Name = "Second block" }, true, null, default);
        Assert.True(first.Active);
        Assert.False(second.Active);

        var promoted = await h.Programs.SetActive(second.Id, true, second.Revision, default);
        Assert.True(promoted.Active);
        var parked = await h.Programs.Get(first.Id, default);
        Assert.False(parked.Active);
        Assert.Equal(ProgramLifecycle.Standby, parked.LifecycleStatus);
    }

    [Fact] public async Task The_dashboard_suggests_the_earliest_unfinished_workout()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        Assert.Equal(program.Workouts[0].Id, program.NextTemplateId);

        var session = await h.Workouts.Start(program.Workouts[0].Id, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)], [new SetInput(60, 10, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var progressed = await h.Programs.Get(program.Id, default);
        Assert.Equal([program.Workouts[0].Id], progressed.CompletedTemplateIds);
        Assert.Equal(program.Workouts[1].Id, progressed.NextTemplateId);
    }

    [Fact] public async Task Finishing_the_last_training_slot_completes_and_deactivates_the_program()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        foreach (var template in program.Workouts.Where(w => !w.IsRestDay))
        {
            var session = await h.Workouts.Start(template.Id, null, default);
            var exercise = session.Exercises.Single();
            await h.Workouts.Save(session.Id, new SessionInput(null,
                [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                    [new SetInput(60, 8, 8, true)])], session.Revision, null), default);
            await h.Workouts.Finish(session.Id, null, default);
        }

        var completed = await h.Programs.Get(program.Id, default);
        Assert.False(completed.Active);
        Assert.Equal(ProgramLifecycle.Completed, completed.LifecycleStatus);
        Assert.Null(completed.NextTemplateId);
        Assert.All(completed.Phases!, phase => Assert.True(phase.Complete));
    }

    [Fact] public async Task A_skipped_slot_can_complete_a_program_and_be_reopened()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        var first = program.Workouts[0];
        var session = await h.Workouts.Start(first.Id, null, default);
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(60, 8, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
        var remaining = program.Workouts.Where(w => w.Id != first.Id && !w.IsRestDay).ToList();

        var completed = await h.Programs.Skip(program.Id, remaining[0].Id, default);
        completed = await h.Programs.Skip(program.Id, remaining[1].Id, default);
        Assert.Equal(ProgramLifecycle.Completed, completed.LifecycleStatus);
        Assert.Contains(remaining[0].Id, completed.SkippedTemplateIds!);

        var reopened = await h.Programs.Unskip(program.Id, remaining[1].Id, default);
        Assert.Equal(ProgramLifecycle.Standby, reopened.LifecycleStatus);
        Assert.Equal(remaining[1].Id, reopened.NextTemplateId);
    }

    [Fact] public async Task A_completed_program_can_be_repeated_as_a_fresh_standby_instance()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var original = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        foreach (var template in original.Workouts.Where(w => !w.IsRestDay))
        {
            var session = await h.Workouts.Start(template.Id, null, default);
            var exercise = session.Exercises.Single();
            await h.Workouts.Save(session.Id, new SessionInput(null,
                [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                    [new SetInput(60, 8, 8, true)])], session.Revision, null), default);
            await h.Workouts.Finish(session.Id, null, default);
        }
        var repeated = await h.Programs.Repeat(original.Id, "Asia/Kuala_Lumpur", default);
        Assert.NotEqual(original.Id, repeated.Id);
        Assert.Equal(ProgramLifecycle.Standby, repeated.LifecycleStatus);
        Assert.False(repeated.Active);
        Assert.Equal(original.Workouts.Select(w => w.Name), repeated.Workouts.Select(w => w.Name));
        Assert.Empty(repeated.CompletedTemplateIds);
        Assert.Equal("Asia/Kuala_Lumpur", repeated.TimeZone);
    }

    [Fact] public async Task Deleting_a_program_leaves_its_finished_history_behind()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        var session = await h.Workouts.Start(program.Workouts[0].Id, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)], [new SetInput(60, 10, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        await h.Programs.Delete(program.Id, default);
        var history = await h.Workouts.History(0, 10, default);
        Assert.Equal(1, history.Total);
        Assert.Equal("Bench press", history.Sessions.Single().Exercises.Single().Name);
        Assert.Null(history.Sessions.Single().ProgramId);
    }

    [Fact] public async Task An_active_workout_blocks_deleting_the_program_it_came_from()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        await h.Workouts.Start(program.Workouts[0].Id, null, default);
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Programs.Delete(program.Id, default));
        Assert.Equal(409, failure.Status);
    }

    [Fact] public async Task A_program_cannot_reference_an_exercise_outside_the_library()
    {
        var (h, _) = await Ready();
        await using var _h = h;
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Programs.Create(TwoWeeks(Guid.NewGuid()), true, null, default));
        Assert.Equal(400, failure.Status);
    }

    [Fact] public async Task Per_set_differences_survive_into_the_stored_program()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(new ProgramInput("Mixed", null,
            [new ProgramWorkoutInput(1, "Day A", null, null,
                [Harness.Exercise(benchId, "Bench press", new SetPrescription(8, 10, 8, 120, "3010", "70%", "top set"), new SetPrescription(12, 12, 7.5, null, null, null, null))])], null),
            true, null, default);
        var sets = program.Workouts.Single().Exercises.Single().Sets;
        Assert.Equal(2, sets.Count);
        Assert.Equal(new SetPrescription(8, 10, 8, 120, "3010", "70%", "top set"), sets[0]);
        Assert.Equal(new SetPrescription(12, 12, 7.5, null, null, null, null), sets[1]);
    }

    [Fact] public async Task Rest_days_are_stored_but_never_selected_as_the_next_workout()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(new ProgramInput("Blocks", null,
            [
                new ProgramWorkoutInput(1, "Monday", "Push", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block 1", "Base", 1, false, 1),
                new ProgramWorkoutInput(1, "Tuesday recovery", null, "Sleep and recover", [], "Block 1", "Base", 1, true),
                new ProgramWorkoutInput(1, "Wednesday", "Pull", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block 1", "Base", 1, false, 3)
            ], null, new DateOnly(2026, 9, 14)), true, null, default);

        Assert.Equal(3, program.Workouts.Count);
        Assert.True(program.Workouts[1].IsRestDay);
        Assert.Equal(program.Workouts[0].Id, program.NextTemplateId);
        await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Start(program.Workouts[1].Id, null, default));
        var first = await h.Workouts.Start(program.Workouts[0].Id, null, default);
        var firstExercise = first.Exercises.Single();
        await h.Workouts.Save(first.Id, new SessionInput(null,
            [new SessionExerciseInput(firstExercise.ExerciseId, firstExercise.Name, firstExercise.Note,
                firstExercise.Prescription, [new SetInput(60, 8, 8, true)])], first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);
        var afterFirst = await h.Programs.Get(program.Id, default);
        Assert.Equal(program.Workouts[2].Id, afterFirst.NextTemplateId);
    }

    [Fact] public async Task A_rest_only_phase_keeps_its_duration_before_the_next_phase_can_start()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var anchor = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var program = await h.Programs.Create(new ProgramInput("Rest bridge", null,
            [
                new ProgramWorkoutInput(1, "Base A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block", "Base", 1, false, 1),
                new ProgramWorkoutInput(2, "Recovery week", null, null, [], "Block", "Recovery", 1, true, 1),
                new ProgramWorkoutInput(3, "Peak A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(5, 8))], "Block", "Peak", 1, false, 1)
            ], null, anchor), true, null, default);

        var session = await h.Workouts.Start(program.Workouts[0].Id, null, default);
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(60, 8, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var after = await h.Programs.Get(program.Id, default);
        Assert.True(after.Active);
        Assert.Equal(ProgramLifecycle.Active, after.LifecycleStatus);
        Assert.False(after.Phases![1].Complete);
        await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Start(program.Workouts[2].Id, null, default));
    }

    [Fact] public async Task A_late_phase_completion_shifts_the_following_phase_to_the_next_monday()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var thisMonday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var originalAnchor = thisMonday.AddDays(-28);
        var program = await h.Programs.Create(new ProgramInput("Late block", null,
            [
                new ProgramWorkoutInput(1, "Base", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block", "Base", 1, false, 1),
                new ProgramWorkoutInput(2, "Peak", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(5, 8))], "Block", "Peak", 1, false, 1)
            ], null, originalAnchor), true, null, default);

        var session = await h.Workouts.Start(program.Workouts[0].Id, null, default);
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(60, 8, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var after = await h.Programs.Get(program.Id, default);
        var nextMonday = today.AddDays(((int)DayOfWeek.Monday - (int)today.DayOfWeek + 7) % 7 is 0 ? 7 : ((int)DayOfWeek.Monday - (int)today.DayOfWeek + 7) % 7);
        Assert.Equal(nextMonday, after.Phases![1].StartDate);
        Assert.True(after.Phases[1].StartDate > originalAnchor.AddDays(7));
    }
}
