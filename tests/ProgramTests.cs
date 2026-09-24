using Workout.Api.Domain;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class ProgramTests
{
    private static ProgramInput TwoWeeks(Guid benchId) => new("Starting strength",
    [
        new ProgramWorkoutInput(1, "Week 1 Day A", "Push", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))]),
        new ProgramWorkoutInput(1, "Week 1 Day B", "Pull", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))]),
        new ProgramWorkoutInput(2, "Week 2 Day A", "Push", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(6, 8))])
    ]);

    private static async Task<(Harness h, Guid benchId)> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        return (h, await h.ExerciseId("bench"));
    }

    private static ProgramDayActionInput Action(ProgramView program)
    {
        var progress = program.Progress ?? throw new InvalidOperationException("The active program has no run progress.");
        return new ProgramDayActionInput(program.Revision, progress.RunId, progress.CurrentWeek,
            progress.CurrentAttempt, Guid.NewGuid());
    }

    private static async Task CompleteWorkout(Harness h, Guid templateId)
    {
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(60, 8, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
    }
    /// A ten-day asynchronous cycle keeps the week its PDF prints; only a week beyond two weeks'
    /// worth of days is refused.
    [Fact] public async Task Program_creation_accepts_a_ten_day_week_and_rejects_more_than_fourteen()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        List<ProgramWorkoutInput> Week(int days) => Enumerable.Range(1, days).Select(index => new ProgramWorkoutInput(1, $"Day {index}", null, null,
            [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))])).ToList();

        var created = await h.Programs.Create(new ProgramInput("Ten day cycle", Week(10)), false, null, default);
        var error = await Assert.ThrowsAsync<DomainException>(() =>
            h.Programs.Create(new ProgramInput("Fifteen day week", Week(15)), false, null, default));

        Assert.NotNull(created);
        Assert.Equal(422, error.Status);
    }
    [Fact] public async Task Program_creation_rejects_missing_weeks_between_phases()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var input = new ProgramInput("Gapped phases",
        [
            new ProgramWorkoutInput(1, "Base", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block 1", "Base", 1, false),
            new ProgramWorkoutInput(3, "Peak", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(5, 8))], "Block 1", "Peak", 1, false)
        ]);

        var error = await Assert.ThrowsAsync<DomainException>(() =>
            h.Programs.Create(input, false, null, default));

        Assert.Equal(422, error.Status);
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
        var program = await h.Programs.Create(new ProgramInput("Two phases",
            [
                new ProgramWorkoutInput(1, "Base A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block 1", "Base", 1, false, 12),
                new ProgramWorkoutInput(2, "Base A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block 1", "Base", 2, false, 18),
                new ProgramWorkoutInput(3, "Peak A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(5, 8))], "Block 1", "Peak", 1, false, 24),
                new ProgramWorkoutInput(4, "Peak A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(5, 8))], "Block 1", "Peak", 2, false, 30)
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

    [Fact] public async Task Finishing_the_last_week_returns_the_program_to_standby()
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
        Assert.Equal(ProgramLifecycle.Standby, completed.LifecycleStatus);
        Assert.Null(completed.NextTemplateId);
        Assert.Equal(completed.Progress!.TotalDays, completed.Progress.PassedDays);
        Assert.All(completed.Phases!, phase => Assert.True(phase.Complete));
    }

    [Fact] public async Task Passed_workouts_can_complete_a_program_but_cannot_be_unticked()
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
        Assert.Equal(ProgramLifecycle.Standby, completed.LifecycleStatus);
        Assert.Contains(remaining[0].Id, completed.SkippedTemplateIds!);

        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Programs.Unskip(program.Id, remaining[1].Id, default));
        Assert.Equal(409, failure.Status);
        var stillPassed = await h.Programs.Get(program.Id, default);
        Assert.Contains(remaining[1].Id, stillPassed.SkippedTemplateIds!);
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
        var repeated = await h.Programs.Repeat(original.Id, default);
        Assert.NotEqual(original.Id, repeated.Id);
        Assert.Equal(ProgramLifecycle.Standby, repeated.LifecycleStatus);
        Assert.False(repeated.Active);
        Assert.Equal(original.Workouts.Select(w => w.Name), repeated.Workouts.Select(w => w.Name));
        Assert.Empty(repeated.CompletedTemplateIds);
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
        var program = await h.Programs.Create(new ProgramInput("Mixed",
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
        var program = await h.Programs.Create(new ProgramInput("Blocks",
            [
                new ProgramWorkoutInput(1, "Monday", "Push", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block 1", "Base", 1, false, 1),
                new ProgramWorkoutInput(1, "Tuesday recovery", null, "Sleep and recover", [], "Block 1", "Base", 1, true),
                new ProgramWorkoutInput(1, "Wednesday", "Pull", null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block 1", "Base", 1, false, 3)
            ]), true, null, default);

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

    [Fact] public async Task A_rest_only_phase_waits_for_its_rest_day_to_be_ticked()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(new ProgramInput("Rest phase",
            [
                new ProgramWorkoutInput(1, "Base A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block", "Base", 1, false, 1),
                new ProgramWorkoutInput(2, "Recovery week", null, null, [], "Block", "Recovery", 1, true, 1),
                new ProgramWorkoutInput(3, "Peak A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(5, 8))], "Block", "Peak", 1, false, 1)
            ]), true, null, default);

        await CompleteWorkout(h, program.Workouts[0].Id);
        var after = await h.Programs.Get(program.Id, default);
        Assert.True(after.Active);
        Assert.Equal(2, after.Progress!.CurrentWeek);
        Assert.Null(after.NextTemplateId);
        Assert.Equal(ProgramDayStatus.Pending, Assert.Single(after.Progress.Days).Status);

        var restDay = program.Workouts.Single(workout => workout.Week == 2);
        after = await h.Programs.AcknowledgeRest(program.Id, restDay.Id, Action(after), default);
        Assert.Equal(3, after.Progress!.CurrentWeek);
        Assert.True(after.Phases![0].Complete);
        Assert.True(after.Phases[1].Complete);
        Assert.False(after.Phases[2].Complete);
        Assert.Equal(program.Workouts[2].Id, after.NextTemplateId);
        var peakSession = await h.Workouts.Start(program.Workouts[2].Id, null, default);
        Assert.NotNull(peakSession);
    }

    [Fact] public async Task A_rest_only_first_phase_requires_a_tick_before_training_week_is_available()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(new ProgramInput("Initial rest",
            [
                new ProgramWorkoutInput(1, "Prep rest", null, null, [], "Block", "Prep", 1, true, 1),
                new ProgramWorkoutInput(2, "Base A", null, null, [Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))], "Block", "Base", 1, false, 1)
            ]), true, null, default);

        var active = await h.Programs.Get(program.Id, default);
        Assert.True(active.Active);
        Assert.Equal(1, active.Progress!.CurrentWeek);
        Assert.Null(active.NextTemplateId);
        Assert.Equal(ProgramDayStatus.Pending, Assert.Single(active.Progress.Days).Status);

        var restDay = program.Workouts[0];
        var advanced = await h.Programs.AcknowledgeRest(program.Id, restDay.Id, Action(active), default);
        Assert.True(advanced.Phases![0].Complete);
        Assert.False(advanced.Phases[1].Complete);
        Assert.Equal(2, advanced.Progress!.CurrentWeek);
        Assert.Equal(program.Workouts[1].Id, advanced.NextTemplateId);
    }

    [Fact] public async Task Program_advances_in_strict_week_and_position_order_without_calendar_delays()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        Assert.Equal(program.Workouts[0].Id, program.NextTemplateId);

        // Finish Day 0
        var s1 = await h.Workouts.Start(program.Workouts[0].Id, null, default);
        var e1 = s1.Exercises.Single();
        await h.Workouts.Save(s1.Id, new SessionInput(null, [new SessionExerciseInput(e1.ExerciseId, e1.Name, null, e1.Prescription, [new SetInput(60, 8, 8, true)])], s1.Revision, null), default);
        await h.Workouts.Finish(s1.Id, null, default);

        var p1 = await h.Programs.Get(program.Id, default);
        Assert.Equal(program.Workouts[1].Id, p1.NextTemplateId);

        // Finish Day 1
        var s2 = await h.Workouts.Start(program.Workouts[1].Id, null, default);
        var e2 = s2.Exercises.Single();
        await h.Workouts.Save(s2.Id, new SessionInput(null, [new SessionExerciseInput(e2.ExerciseId, e2.Name, null, e2.Prescription, [new SetInput(60, 8, 8, true)])], s2.Revision, null), default);
        await h.Workouts.Finish(s2.Id, null, default);

        var p2 = await h.Programs.Get(program.Id, default);
        Assert.Equal(program.Workouts[2].Id, p2.NextTemplateId);
    }
}
