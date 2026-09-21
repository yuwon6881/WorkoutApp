using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class ProgramWeekProgressTests
{
    private static async Task<(Harness Harness, Guid ExerciseId)> Ready()
    {
        var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        return (harness, await harness.ExerciseId("bench"));
    }

    private static ProgramInput SevenDayProgram(Guid exerciseId)
    {
        var workouts = new List<ProgramWorkoutInput>
        {
            Workout(1, "Monday", exerciseId),
            Rest(1, "Tuesday rest"),
            Workout(1, "Wednesday", exerciseId),
            Workout(1, "Thursday", exerciseId),
            Rest(1, "Friday rest"),
            Workout(1, "Saturday", exerciseId),
            Workout(1, "Sunday", exerciseId),
            Workout(2, "Week two", exerciseId)
        };
        return new ProgramInput("Sequential weeks", workouts);
    }

    private static ProgramWorkoutInput Workout(int week, string name, Guid exerciseId)
        => new(week, name, "Strength", null, [Harness.Exercise(exerciseId, "Bench press", Harness.Set(8, 10))]);

    private static ProgramWorkoutInput Rest(int week, string name)
        => new(week, name, null, "Recover", [], IsRestDay: true);

    private static ProgramDayActionInput Action(ProgramView program)
    {
        var progress = Assert.IsType<ProgramProgressView>(program.Progress);
        return new ProgramDayActionInput(program.Revision, progress.RunId, progress.CurrentWeek,
            progress.CurrentAttempt, Guid.NewGuid());
    }

    private static ProgramWeekResetInput Reset(ProgramView program, string confirmation = "RESET")
    {
        var progress = Assert.IsType<ProgramProgressView>(program.Progress);
        return new ProgramWeekResetInput(program.Revision, progress.RunId, progress.CurrentWeek,
            progress.CurrentAttempt, confirmation, Guid.NewGuid());
    }

    private static async Task CompleteWorkout(Harness harness, Guid templateId)
    {
        var session = await harness.Workouts.Start(templateId, null, default);
        var exercise = Assert.Single(session.Exercises);
        await harness.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(60, 8, 8, true)])], session.Revision, null), default);
        await harness.Workouts.Finish(session.Id, null, default);
    }

    [Fact]
    public async Task Activation_exposes_only_the_first_seven_days_and_workouts_can_start_out_of_order()
    {
        var (h, exerciseId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(SevenDayProgram(exerciseId), true, null, default);
        var weekOne = program.Workouts.Where(day => day.Week == 1).ToList();
        var nextWeekWorkout = Assert.Single(program.Workouts, day => day.Week == 2);
        var progress = Assert.IsType<ProgramProgressView>(program.Progress);

        Assert.Equal(1, progress.CurrentWeek);
        Assert.Equal(7, progress.TotalDays);
        Assert.Equal(7, progress.Days.Count);
        Assert.Equal(weekOne.Select(day => day.Id).Order(), progress.Days.Select(day => day.TemplateId).Order());

        var lastWorkout = weekOne.Last(day => !day.IsRestDay);
        await CompleteWorkout(h, lastWorkout.Id);

        var afterCompletion = await h.Programs.Get(program.Id, default);
        Assert.Equal(1, afterCompletion.Progress!.CurrentWeek);
        Assert.Equal(1, afterCompletion.Progress.PassedDays);
        Assert.Equal(ProgramDayStatus.Completed,
            afterCompletion.Progress.Days.Single(day => day.TemplateId == lastWorkout.Id).Status);
        var outsideCurrentWeek = await Assert.ThrowsAsync<DomainException>(
            () => h.Workouts.Start(nextWeekWorkout.Id, null, default));
        Assert.Equal(409, outsideCurrentWeek.Status);

        var cannotUntick = await Assert.ThrowsAsync<DomainException>(
            () => h.Programs.Unskip(program.Id, lastWorkout.Id, default));
        Assert.Equal(409, cannotUntick.Status);
    }

    [Fact]
    public async Task The_program_advances_only_after_all_seven_days_and_returns_to_standby_after_the_final_week()
    {
        var (h, exerciseId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(SevenDayProgram(exerciseId), true, null, default);
        var weekOne = program.Workouts.Where(day => day.Week == 1).ToList();
        var firstCompleted = weekOne.Last(day => !day.IsRestDay);
        await CompleteWorkout(h, firstCompleted.Id);

        foreach (var workout in weekOne.Where(day => !day.IsRestDay && day.Id != firstCompleted.Id))
        {
            program = await h.Programs.Get(program.Id, default);
            program = await h.Programs.Skip(program.Id, workout.Id, Action(program), default);
        }

        var restDays = weekOne.Where(day => day.IsRestDay).ToList();
        program = await h.Programs.Get(program.Id, default);
        program = await h.Programs.AcknowledgeRest(program.Id, restDays[0].Id, Action(program), default);
        Assert.Equal(1, program.Progress!.CurrentWeek);
        Assert.Equal(6, program.Progress.PassedDays);
        Assert.Equal(7, program.Progress.TotalDays);

        var weekTwoWorkout = Assert.Single(program.Workouts, day => day.Week == 2);
        var tooEarly = await Assert.ThrowsAsync<DomainException>(
            () => h.Workouts.Start(weekTwoWorkout.Id, null, default));
        Assert.Equal(409, tooEarly.Status);

        program = await h.Programs.AcknowledgeRest(program.Id, restDays[1].Id, Action(program), default);
        Assert.Equal(2, program.Progress!.CurrentWeek);
        Assert.Equal(1, program.Progress.TotalDays);
        Assert.Equal(ProgramDayStatus.Pending, Assert.Single(program.Progress.Days).Status);

        await CompleteWorkout(h, weekTwoWorkout.Id);
        var finished = await h.Programs.Get(program.Id, default);
        Assert.False(finished.Active);
        Assert.Equal(ProgramLifecycle.Standby, finished.LifecycleStatus);
        Assert.Null(finished.NextTemplateId);
    }

    [Fact]
    public async Task Legacy_active_program_keeps_an_unpassed_rest_only_week_current()
    {
        var (h, exerciseId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(new ProgramInput("Legacy rest week",
        [
            Rest(1, "Recovery week"),
            Workout(2, "Week two", exerciseId),
            Workout(3, "Week three", exerciseId)
        ]), false, null, default);
        var stored = h.Db.Programs.Single(candidate => candidate.Id == program.Id);
        stored.Active = true;
        stored.LifecycleStatus = ProgramLifecycle.Active;
        stored.Revision++;
        await h.Db.SaveChangesAsync();

        await h.Programs.List(default);
        var active = await h.Programs.Get(program.Id, default);
        Assert.Equal(1, active.Progress!.CurrentWeek);
        Assert.Equal(ProgramDayStatus.Pending, Assert.Single(active.Progress.Days).Status);
        Assert.Equal(program.Workouts.Count, await h.Db.ProgramDayProgresses.CountAsync());

        var restDay = program.Workouts[0];
        var advanced = await h.Programs.AcknowledgeRest(program.Id, restDay.Id, Action(active), default);
        Assert.Equal(2, advanced.Progress!.CurrentWeek);
        Assert.Equal(program.Workouts[1].Id, advanced.NextTemplateId);
    }
    [Fact]
    public async Task Week_reset_requires_confirmation_and_no_active_workout_and_preserves_history()
    {
        var (h, exerciseId) = await Ready();
        await using var _h = h;
        var program = await h.Programs.Create(SevenDayProgram(exerciseId), true, null, default);
        var weekOne = program.Workouts.Where(day => day.Week == 1).ToList();
        var completedWorkout = weekOne.First(day => !day.IsRestDay);
        await CompleteWorkout(h, completedWorkout.Id);

        program = await h.Programs.Get(program.Id, default);
        var restDay = weekOne.First(day => day.IsRestDay);
        program = await h.Programs.AcknowledgeRest(program.Id, restDay.Id, Action(program), default);

        var invalidConfirmation = await Assert.ThrowsAsync<DomainException>(
            () => h.Programs.ResetWeek(program.Id, Reset(program, "reset"), default));
        Assert.Equal(422, invalidConfirmation.Status);

        var pendingWorkout = weekOne.First(day => !day.IsRestDay && day.Id != completedWorkout.Id);
        var activeSession = await h.Workouts.Start(pendingWorkout.Id, null, default);
        var activeGuard = await Assert.ThrowsAsync<DomainException>(
            () => h.Programs.ResetWeek(program.Id, Reset(program), default));
        Assert.Equal(409, activeGuard.Status);
        await h.Workouts.Discard(activeSession.Id, default);

        program = await h.Programs.Get(program.Id, default);
        var reset = await h.Programs.ResetWeek(program.Id, Reset(program), default);
        Assert.Equal(1, reset.Progress!.CurrentWeek);
        Assert.Equal(2, reset.Progress.CurrentAttempt);
        Assert.Equal(0, reset.Progress.PassedDays);
        Assert.All(reset.Progress.Days, day => Assert.Equal(ProgramDayStatus.Pending, day.Status));

        var history = await h.Workouts.History(0, 10, default);
        Assert.Equal(1, history.Total);
        Assert.Equal(completedWorkout.Id, history.Sessions.Single().TemplateId);
    }
}
