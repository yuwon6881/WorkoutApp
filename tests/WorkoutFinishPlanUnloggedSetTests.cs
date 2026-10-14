using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A set left unlogged is only left out of the saved workout. It is not a change to the plan, so
/// finishing never takes it out of the program's other days; only removing it on purpose does.
public sealed class WorkoutFinishPlanUnloggedSetTests
{
    private sealed record Rig(Harness H, Guid Bench, Guid Squat, ProgramView Program) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => H.DisposeAsync();
    }

    private static async Task<Rig> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null), new SeedExercise("squat", "Back squat", "Quads", "Barbell", null));
        var bench = await h.ExerciseId("bench");
        var sets = new[] { Harness.Set(8, 10), Harness.Set(8, 10), Harness.Set(8, 10) };
        var program = await h.Programs.Create(new ProgramInput("Program", [
            new ProgramWorkoutInput(1, "First", "Push", null, [Harness.Exercise(bench, "Bench", sets)]),
            new ProgramWorkoutInput(2, "Second", "Push", null, [Harness.Exercise(bench, "Bench", sets)])
        ]), true, null, default);
        return new Rig(h, bench, await h.ExerciseId("squat"), program);
    }

    private static SetInput Logged(SetView set) => new(60, 8, 8, true, Id: set.Id);
    private static SetInput Open(SetView set) => new(null, null, null, false, Id: set.Id);

    /// Swaps the exercise, logs the first two sets, and leaves the third as the caller decides.
    private static async Task<SessionView> SwappedSession(Rig rig, bool removeThird)
    {
        var session = await rig.H.Workouts.Start(rig.Program.Workouts.Single(day => day.Week == 1).Id, null, default);
        session = await rig.H.Workouts.Swap(session.Id,
            new SessionSubstitutionInput(session.Exercises[0].Id, rig.Squat, "Back squat", session.Revision, null), default);
        var exercise = session.Exercises[0];
        var sets = exercise.Sets.Take(2).Select(Logged).ToList();
        var prescription = exercise.Prescription;
        if (!removeThird) sets.Add(Open(exercise.Sets[2]));
        else prescription = prescription.Take(2).ToList();
        return await rig.H.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(rig.Squat, "Back squat", null, prescription, sets, Id: exercise.Id)], session.Revision, null), default);
    }

    private static async Task<List<SetPrescription>> SetsOf(Rig rig, int week)
    {
        var day = await rig.H.Db.Templates.AsNoTracking().SingleAsync(t => t.ProgramId == rig.Program.Id && t.Week == week);
        return Json.Read<List<SetPrescription>>((await rig.H.Db.TemplateExercises.AsNoTracking().SingleAsync(e => e.TemplateId == day.Id)).SetsJson);
    }

    [Fact]
    public async Task An_unlogged_set_after_a_swap_is_not_offered_as_a_plan_change_and_stays_in_other_days()
    {
        await using var rig = await Ready();
        var session = await SwappedSession(rig, removeThird: false);

        var preview = await rig.H.Workouts.PreviewFinishPlan(session.Id, default);

        // The swap is the only change on offer.
        Assert.Equal(["library exercise"], preview.Changes);
        var plan = new FinishPlanUpdateInput("program", preview.ChangesHash, preview.ProgramRevision, preview.DayRevisions);
        var finished = await rig.H.Workouts.Finish(session.Id, session.Revision, default, planUpdate: plan);

        Assert.Equal(2, finished.Exercises.Single().Sets.Count);
        var later = await rig.H.Db.TemplateExercises.AsNoTracking().SingleAsync(e => e.TemplateId ==
            rig.H.Db.Templates.Single(t => t.ProgramId == rig.Program.Id && t.Week == 2).Id);
        Assert.Equal("Back squat", later.SourceName);
        Assert.Equal(3, (await SetsOf(rig, 2)).Count);
        Assert.Equal(3, (await SetsOf(rig, 1)).Count);
    }

    [Fact]
    public async Task Just_this_workout_leaves_the_program_untouched_even_with_an_unlogged_set()
    {
        await using var rig = await Ready();
        var session = await SwappedSession(rig, removeThird: false);

        await rig.H.Workouts.Finish(session.Id, session.Revision, default);

        Assert.Equal(3, (await SetsOf(rig, 1)).Count);
        Assert.Equal(3, (await SetsOf(rig, 2)).Count);
    }

    [Fact]
    public async Task Removing_the_set_on_purpose_is_a_plan_change_that_reaches_the_other_days()
    {
        await using var rig = await Ready();
        var session = await SwappedSession(rig, removeThird: true);

        var preview = await rig.H.Workouts.PreviewFinishPlan(session.Id, default);
        Assert.Contains("sets and reps", preview.Changes);
        var plan = new FinishPlanUpdateInput("program", preview.ChangesHash, preview.ProgramRevision, preview.DayRevisions);
        await rig.H.Workouts.Finish(session.Id, session.Revision, default, planUpdate: plan);

        Assert.Equal(2, (await SetsOf(rig, 2)).Count);
    }

    [Fact]
    public async Task An_unlogged_set_without_a_swap_offers_no_program_update_at_all()
    {
        await using var rig = await Ready();
        var session = await rig.H.Workouts.Start(rig.Program.Workouts.Single(day => day.Week == 1).Id, null, default);
        var exercise = session.Exercises[0];
        session = await rig.H.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(rig.Bench, exercise.Name, null, exercise.Prescription,
                [Logged(exercise.Sets[0]), Open(exercise.Sets[1]), Open(exercise.Sets[2])], Id: exercise.Id)], session.Revision, null), default);

        var preview = await rig.H.Workouts.PreviewFinishPlan(session.Id, default);

        Assert.Empty(preview.Edits);
        Assert.Empty(preview.Changes);
    }

    /// What the phone sends: every field of the session it last received, unchanged.
    private static SessionInput Resend(SessionView session) => new(session.Note,
        session.Exercises.Select(e => new SessionExerciseInput(e.ExerciseId, e.Name, e.Note, e.Prescription,
            e.Sets.Select(set => new SetInput(set.WeightKg, set.Reps, set.Rpe, set.Done, set.Warmup, set.ResistanceMode, set.Id, set.Rir, set.DurationSeconds)).ToList(),
            e.SequenceGroup, e.Substitutions, e.LoadModel, e.Id, e.SourceTemplateExerciseId, e.SourceSlotKey, e.SourcePhaseId, e.SourcePage, e.RestSeconds)).ToList(),
        session.Revision, null);

    [Fact]
    public async Task Saving_the_workout_again_right_before_finishing_does_not_invalidate_the_program_review()
    {
        await using var rig = await Ready();
        var session = await SwappedSession(rig, removeThird: false);
        var reviewed = await rig.H.Workouts.PreviewFinishPlan(session.Id, default);

        // Finishing on the phone saves the whole draft once more before it asks to finish.
        session = await rig.H.Workouts.Save(session.Id, Resend(session), default);
        var again = await rig.H.Workouts.PreviewFinishPlan(session.Id, default);

        Assert.Equal(reviewed.ChangesHash, again.ChangesHash);
        Assert.Equal(reviewed.ProgramRevision, again.ProgramRevision);
        Assert.Equal(reviewed.DayRevisions, again.DayRevisions);
        var plan = new FinishPlanUpdateInput("program", reviewed.ChangesHash, reviewed.ProgramRevision, reviewed.DayRevisions);
        await rig.H.Workouts.Finish(session.Id, session.Revision, default, planUpdate: plan);
        Assert.Equal("Back squat", (await rig.H.Db.TemplateExercises.AsNoTracking().SingleAsync(e => e.TemplateId ==
            rig.H.Db.Templates.Single(t => t.ProgramId == rig.Program.Id && t.Week == 2).Id)).SourceName);
    }
}
