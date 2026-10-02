using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The active slot holds one program or one standalone workout. Leaving the slot forgets run
/// progress so a later activation always starts from the first week; finished history stays.
public class ActiveSlotTests
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

    private static async Task CompleteWorkout(Harness h, Guid templateId)
    {
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(60, 8, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
    }

    private static async Task<TemplateView> Standalone(Harness h, Guid benchId)
        => await h.Templates.Create(Harness.Template("Quick push", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);

    [Fact]
    public async Task Moving_a_program_to_the_library_forgets_its_run_but_keeps_history()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        await CompleteWorkout(h, program.Workouts[0].Id);

        program = await h.Programs.Get(program.Id, default);
        var parked = await h.Programs.SetActive(program.Id, false, program.Revision, default);

        Assert.False(parked.Active);
        Assert.Equal(ProgramLifecycle.Standby, parked.LifecycleStatus);
        Assert.Null(parked.Progress);
        Assert.Empty(parked.CompletedTemplateIds);
        Assert.False(await h.Db.ProgramRuns.AnyAsync(run => run.ProgramId == program.Id));
        Assert.False(await h.Db.ProgramDayProgresses.AnyAsync(day => day.ProgramId == program.Id));
        var history = await h.Workouts.History(0, 10, default);
        Assert.Equal(1, history.Total);
        Assert.Null(h.Db.Workouts.Single().ProgramDayProgressId);
    }

    [Fact]
    public async Task Reactivating_a_program_always_starts_a_fresh_run_at_the_first_week()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        await CompleteWorkout(h, program.Workouts[0].Id);
        await CompleteWorkout(h, program.Workouts[1].Id);
        program = await h.Programs.Get(program.Id, default);
        Assert.Equal(2, program.Progress!.CurrentWeek);

        program = await h.Programs.SetActive(program.Id, false, program.Revision, default);
        program = await h.Programs.SetActive(program.Id, true, program.Revision, default);

        Assert.True(program.Active);
        Assert.Equal(1, program.Progress!.CurrentWeek);
        Assert.Equal(0, program.Progress.PassedDays);
        Assert.Equal(program.Workouts[0].Id, program.NextTemplateId);
        Assert.Equal(1, await h.Db.ProgramRuns.CountAsync(run => run.ProgramId == program.Id));
    }

    [Fact]
    public async Task A_finished_program_stays_active_as_completed_until_restarted()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        foreach (var template in program.Workouts) await CompleteWorkout(h, template.Id);

        var finished = await h.Programs.Get(program.Id, default);
        Assert.True(finished.Active);
        Assert.Equal(ProgramLifecycle.Completed, finished.LifecycleStatus);
        Assert.NotNull(finished.CompletedAt);
        Assert.Null(finished.NextTemplateId);

        var restarted = await h.Programs.Restart(program.Id, finished.Revision, default);
        Assert.True(restarted.Active);
        Assert.Equal(ProgramLifecycle.Active, restarted.LifecycleStatus);
        Assert.Null(restarted.CompletedAt);
        Assert.Equal(1, restarted.Progress!.CurrentWeek);
        Assert.Equal(0, restarted.Progress.PassedDays);
        Assert.Equal(1, await h.Db.ProgramRuns.CountAsync(run => run.ProgramId == program.Id));

        var stale = await Assert.ThrowsAsync<DomainException>(() => h.Programs.Restart(program.Id, finished.Revision, default));
        Assert.Equal(409, stale.Status);
    }

    [Fact]
    public async Task An_in_progress_workout_blocks_forgetting_its_program()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        await h.Workouts.Start(program.Workouts[0].Id, null, default);
        program = await h.Programs.Get(program.Id, default);

        var deactivate = await Assert.ThrowsAsync<DomainException>(() => h.Programs.SetActive(program.Id, false, program.Revision, default));
        Assert.Equal(409, deactivate.Status);
        var restart = await Assert.ThrowsAsync<DomainException>(() => h.Programs.Restart(program.Id, program.Revision, default));
        Assert.Equal(409, restart.Status);
        var template = await Standalone(h, benchId);
        var swap = await Assert.ThrowsAsync<DomainException>(() => h.ActiveSlot.SetTemplateActive(template.Id, true, template.Revision, default));
        Assert.Equal(409, swap.Status);
    }

    [Fact]
    public async Task A_standalone_workout_shares_the_single_active_slot_with_programs()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        var template = await Standalone(h, benchId);

        var active = await h.ActiveSlot.SetTemplateActive(template.Id, true, template.Revision, default);
        Assert.True(active.Active);
        var parked = await h.Programs.Get(program.Id, default);
        Assert.False(parked.Active);
        Assert.Null(parked.Progress);

        var reactivated = await h.Programs.SetActive(program.Id, true, parked.Revision, default);
        Assert.True(reactivated.Active);
        var displaced = await h.Templates.Get(template.Id, default);
        Assert.False(displaced.Active);
        Assert.Null(displaced.ActiveCompletedAt);
    }

    [Fact]
    public async Task Finishing_the_active_standalone_workout_ticks_it_until_restart_or_deactivation()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var template = await Standalone(h, benchId);
        await CompleteWorkout(h, template.Id);
        Assert.Null((await h.Templates.Get(template.Id, default)).ActiveCompletedAt);

        template = await h.ActiveSlot.SetTemplateActive(template.Id, true, (await h.Templates.Get(template.Id, default)).Revision, default);
        await CompleteWorkout(h, template.Id);
        var finished = await h.Templates.Get(template.Id, default);
        Assert.True(finished.Active);
        Assert.NotNull(finished.ActiveCompletedAt);

        var restarted = await h.ActiveSlot.RestartTemplate(template.Id, finished.Revision, default);
        Assert.True(restarted.Active);
        Assert.Null(restarted.ActiveCompletedAt);

        await CompleteWorkout(h, template.Id);
        var again = await h.Templates.Get(template.Id, default);
        var parked = await h.ActiveSlot.SetTemplateActive(template.Id, false, again.Revision, default);
        Assert.False(parked.Active);
        Assert.Null(parked.ActiveCompletedAt);
    }

    [Fact]
    public async Task Only_a_standalone_workout_can_hold_the_active_slot()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), false, null, default);
        var day = program.Workouts[0];
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.ActiveSlot.SetTemplateActive(day.Id, true, day.Revision, default));
        Assert.Equal(409, failure.Status);
    }
}
