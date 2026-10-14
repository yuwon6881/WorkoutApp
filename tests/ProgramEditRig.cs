using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Shared setup for the program-editing tests: a three-week program, a way to turn a stored
/// program back into an edit, and small helpers that finish or skip days of its run.
internal static class ProgramEditRig
{
    internal sealed record Rig(Harness H, Guid Bench, Guid Squat) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => H.DisposeAsync();
    }

    internal static async Task<Rig> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null),
            new SeedExercise("squat", "Back squat", "Quads", "Barbell", null));
        return new Rig(h, await h.ExerciseId("bench"), await h.ExerciseId("squat"));
    }

    internal static ProgramWorkoutInput Train(int week, string name, Guid exercise, int phaseWeek, string block = "Block 1", string? phase = null)
        => new(week, name, "Strength", null, [Harness.Exercise(exercise, "Bench press", Harness.Set(8, 10))],
            block, phase, phaseWeek);

    internal static ProgramWorkoutInput Rest(int week, string name, int phaseWeek, string block = "Block 1")
        => new(week, name, null, null, [], block, null, phaseWeek, IsRestDay: true);

    /// Week 1: A, B, rest. Week 2: A, B. Week 3: A, B.
    internal static ProgramInput ThreeWeeks(Guid bench) => new("Three weeks",
    [
        Train(1, "W1 A", bench, 1), Train(1, "W1 B", bench, 1), Rest(1, "W1 Rest", 1),
        Train(2, "W2 A", bench, 2), Train(2, "W2 B", bench, 2),
        Train(3, "W3 A", bench, 3), Train(3, "W3 B", bench, 3)
    ]);

    internal static async Task<ProgramView> Active(Rig rig)
        => await rig.H.Programs.Create(ThreeWeeks(rig.Bench), activate: true, null, default);

    internal static async Task<ProgramView> Library(Rig rig)
        => await rig.H.Programs.Create(ThreeWeeks(rig.Bench), activate: false, null, default);

    internal static TemplateView Day(ProgramView program, string name) => program.Workouts.Single(day => day.Name == name);

    internal static ProgramEditDayInput ToDay(TemplateView day) => new(day.Id, day.Week, day.Name, day.Focus, day.Note,
        day.Exercises.Select(exercise => new TemplateExerciseInput(exercise.ExerciseId, exercise.SourceName, exercise.Note,
            exercise.Sets, exercise.SequenceGroup, exercise.Substitutions, exercise.SourcePage, exercise.SlotKey,
            exercise.RestSeconds, exercise.DemoUrl, exercise.DemoLinks)).ToList(),
        day.Block, day.Phase, day.PhaseWeek, day.IsRestDay, day.SourcePage);

    internal static ProgramEditDayInput NewDay(int week, string name, Guid exercise, int? phaseWeek = null, string block = "Block 1")
        => new(Guid.NewGuid(), week, name, "Strength", null, [Harness.Exercise(exercise, "Bench press", Harness.Set(8, 10))],
            block, null, phaseWeek ?? week);

    internal static ProgramEditInput Unchanged(ProgramView program, Guid? idempotency = null)
        => new(program.Name, program.Revision, program.Workouts.Select(ToDay).ToList(), idempotency ?? Guid.NewGuid());

    internal static ProgramEditInput With(ProgramView program, Func<List<ProgramEditDayInput>, List<ProgramEditDayInput>> change, string? name = null)
        => new(name ?? program.Name, program.Revision, change(program.Workouts.Select(ToDay).ToList()), Guid.NewGuid());

    internal static ProgramEditDayInput Rename(ProgramEditDayInput day, string name) => day with { Name = name };

    internal static List<ProgramEditDayInput> Replace(List<ProgramEditDayInput> days, Guid id, Func<ProgramEditDayInput, ProgramEditDayInput> change)
        => days.Select(day => day.Id == id ? change(day) : day).ToList();

    internal static ProgramDayActionInput Action(ProgramView program)
    {
        var progress = Assert.IsType<ProgramProgressView>(program.Progress);
        return new ProgramDayActionInput(program.Revision, progress.RunId, progress.CurrentWeek, progress.CurrentAttempt, Guid.NewGuid());
    }

    internal static async Task Complete(Harness h, Guid templateId)
    {
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(60, 8, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
    }

    internal static async Task<DomainException> Refused(Task action, int status = 409)
    {
        var error = await Assert.ThrowsAsync<DomainException>(() => action);
        Assert.Equal(status, error.Status);
        return error;
    }
}
