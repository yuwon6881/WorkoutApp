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
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null));
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

    [Fact]
    public async Task Non_first_active_standalone_is_selected_over_earlier_library_template()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var first = await h.Templates.Create(Harness.Template("A First", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);
        var second = await h.Templates.Create(Harness.Template("B Second", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 1, default);

        var initial = await ProgramService.StandaloneNext(h.Db, default);
        Assert.NotNull(initial);
        Assert.Equal(first.Id, initial.Id);

        await h.ActiveSlot.SetTemplateActive(second.Id, true, second.Revision, default);

        var activeNext = await ProgramService.StandaloneNext(h.Db, default);
        Assert.NotNull(activeNext);
        Assert.Equal(second.Id, activeNext.Id);
        var hero = await WorkoutHeroReadService.Get(h.Db, activeNext.Id, null, default);
        Assert.Equal(1, hero.WorkingSets);
        Assert.Contains(hero.Muscles, muscle => muscle.Muscle == "Chest" && muscle.Sets == 1);
        Assert.Equal("B Second", activeNext.Name);
        Assert.Equal(1, activeNext.Position);
    }

    [Fact]
    public async Task Completed_active_standalone_suppresses_library_fallback()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var first = await h.Templates.Create(Harness.Template("A First", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);
        var second = await h.Templates.Create(Harness.Template("B Second", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 1, default);
        await h.ActiveSlot.SetTemplateActive(second.Id, true, second.Revision, default);

        await CompleteWorkout(h, second.Id);

        var completed = await h.Templates.Get(second.Id, default);
        Assert.True(completed.Active);
        Assert.NotNull(completed.ActiveCompletedAt);

        var next = await ProgramService.StandaloneNext(h.Db, default);
        Assert.Null(next);
    }

    [Fact]
    public async Task Restart_and_move_to_library_transitions_for_standalone_next()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var first = await h.Templates.Create(Harness.Template("A First", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);
        var second = await h.Templates.Create(Harness.Template("B Second", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 1, default);
        await h.ActiveSlot.SetTemplateActive(second.Id, true, second.Revision, default);
        await CompleteWorkout(h, second.Id);

        Assert.Null(await ProgramService.StandaloneNext(h.Db, default));
        var hero = await WorkoutHeroReadService.Get(h.Db, null, null, default);
        Assert.Equal("B Second", hero.CompletedStandaloneName);

        var finished = await h.Templates.Get(second.Id, default);
        var restarted = await h.ActiveSlot.RestartTemplate(second.Id, finished.Revision, default);
        Assert.True(restarted.Active);
        Assert.Null(restarted.ActiveCompletedAt);

        var resumedNext = await ProgramService.StandaloneNext(h.Db, default);
        Assert.NotNull(resumedNext);
        Assert.Equal(second.Id, resumedNext.Id);

        var moved = await h.ActiveSlot.SetTemplateActive(second.Id, false, restarted.Revision, default);
        Assert.False(moved.Active);

        var libraryFallback = await ProgramService.StandaloneNext(h.Db, default);
        Assert.NotNull(libraryFallback);
        Assert.Equal(first.Id, libraryFallback.Id);
    }

    [Fact]
    public async Task Program_priority_is_preserved_over_standalone_in_launch()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(TwoWeeks(benchId), true, null, default);
        await h.Templates.Create(Harness.Template("Standalone", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);

        var (launchProgram, next) = await h.Programs.Launch(default);
        Assert.NotNull(launchProgram);
        Assert.NotNull(next);
        Assert.Equal(program.Workouts[0].Id, next.Id);
        Assert.Equal("Week 1 Day A", next.Name);
    }

    [Fact]
    public async Task Standalone_next_enforces_account_isolation()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var aliceTemplate = await h.Templates.Create(Harness.Template("Alice Active", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);
        await h.ActiveSlot.SetTemplateActive(aliceTemplate.Id, true, aliceTemplate.Revision, default);

        var aliceNext = await ProgramService.StandaloneNext(h.Db, default);
        Assert.NotNull(aliceNext);
        Assert.Equal(aliceTemplate.Id, aliceNext.Id);

        await h.SignIn("bob");

        var bobNextEmpty = await ProgramService.StandaloneNext(h.Db, default);
        Assert.Null(bobNextEmpty);

        var bobTemplate = await h.Templates.Create(Harness.Template("Bob Library", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);
        var bobNext = await ProgramService.StandaloneNext(h.Db, default);
        Assert.NotNull(bobNext);
        Assert.Equal(bobTemplate.Id, bobNext.Id);
        Assert.NotEqual(aliceTemplate.Id, bobNext.Id);
    }

    [Fact]
    public async Task Standalone_next_projects_summary_fields_and_exercise_count()
    {
        var (h, benchId) = await Ready();
        await using var _h = h;
        var template = await h.Templates.Create(Harness.Template("Two Moves",
            Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10)),
            Harness.Exercise(benchId, "Bench press 2", Harness.Set(10, 12))), null, 1, 3, default);
        await h.ActiveSlot.SetTemplateActive(template.Id, true, template.Revision, default);

        var next = await ProgramService.StandaloneNext(h.Db, default);
        Assert.NotNull(next);
        Assert.Equal(template.Id, next.Id);
        Assert.Equal("Two Moves", next.Name);
        Assert.Equal("Focus", next.Focus);
        Assert.Equal(1, next.Week);
        Assert.Equal(3, next.Position);
        Assert.Equal(2, next.ExerciseCount);
    }
}
