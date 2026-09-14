using Workout.Api.Domain;
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
        Assert.False((await h.Programs.Get(first.Id, default)).Active);
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
}
