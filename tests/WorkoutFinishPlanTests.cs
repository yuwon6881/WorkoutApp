using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class WorkoutFinishPlanTests
{
    [Fact]
    public async Task Finish_carries_only_changed_fields_and_replays_without_applying_twice()
    {
        await using var h = await Harness.Create();
        var edited = await Prepare(h);
        var preview = await h.Workouts.PreviewFinishPlan(edited.Id, default);
        Assert.Equal(1, preview.Counts.Program);
        var input = new FinishPlanUpdateInput("program", preview.ChangesHash, preview.ProgramRevision, preview.DayRevisions);
        var mutationId = Guid.NewGuid();
        var saved = await h.Workouts.Finish(edited.Id, edited.Revision, default, mutationId: mutationId, planUpdate: input);
        Assert.False(saved.Active);
        var days = await h.Db.Templates.Where(t => t.ProgramId == edited.ProgramId).ToListAsync();
        foreach (var day in days)
        {
            var row = await h.Db.TemplateExercises.SingleAsync(e => e.TemplateId == day.Id);
            Assert.Equal("Workout note", row.Note);
            var sets = Json.Read<List<SetPrescription>>(row.SetsJson);
            Assert.Equal(day.Week == 1 ? 8 : 6, sets[0].RepMin);
            Assert.Equal(day.Week == 1 ? "2" : "3", sets[0].Rir);
        }
        var revisions = days.Select(d => d.Revision).ToList();
        await h.Workouts.Finish(edited.Id, edited.Revision, default, mutationId: mutationId, planUpdate: input);
        Assert.Equal(revisions, days.Select(d => d.Revision));
    }

    [Fact]
    public async Task A_concurrent_day_edit_refuses_finish_without_changing_any_program_day()
    {
        await using var h = await Harness.Create();
        var edited = await Prepare(h);
        var preview = await h.Workouts.PreviewFinishPlan(edited.Id, default);
        var other = await h.Db.Templates.SingleAsync(t => t.ProgramId == edited.ProgramId && t.Week == 2);
        other.Revision++;
        var otherExercise = await h.Db.TemplateExercises.SingleAsync(e => e.TemplateId == other.Id);
        otherExercise.Note = "Other device";
        await h.Db.SaveChangesAsync();
        var input = new FinishPlanUpdateInput("program", preview.ChangesHash, preview.ProgramRevision, preview.DayRevisions);
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Finish(edited.Id, edited.Revision, default, planUpdate: input));
        Assert.Equal(409, failure.Status);
        Assert.True((await h.Workouts.Get(edited.Id, default)).Active);
        var home = await h.Db.TemplateExercises.SingleAsync(e => e.TemplateId == edited.TemplateId);
        Assert.Equal("Original", home.Note);
        Assert.Equal("Other device", otherExercise.Note);
    }

    [Fact]
    public async Task A_changed_rep_target_preserves_the_other_days_effort_taper()
    {
        await using var h = await Harness.Create();
        var edited = await Prepare(h);
        var exercise = edited.Exercises[0];
        var prescription = exercise.Prescription.Select(set => set with { RepMin = 9, RepMax = 11 }).ToList();
        edited = await h.Workouts.Save(edited.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, exercise.Note, prescription,
                exercise.Sets.Select(set => new SetInput(set.WeightKg, set.Reps, set.Rpe, set.Done, Id: set.Id, Rir: set.Rir)).ToList(), Id: exercise.Id)], edited.Revision, null), default);
        var preview = await h.Workouts.PreviewFinishPlan(edited.Id, default);
        await h.Workouts.Finish(edited.Id, edited.Revision, default, planUpdate:
            new FinishPlanUpdateInput("program", preview.ChangesHash, preview.ProgramRevision, preview.DayRevisions));
        var other = await h.Db.Templates.SingleAsync(t => t.ProgramId == edited.ProgramId && t.Week == 2);
        var row = await h.Db.TemplateExercises.SingleAsync(e => e.TemplateId == other.Id);
        var set = Json.Read<List<SetPrescription>>(row.SetsJson).Single();
        Assert.Equal(9, set.RepMin);
        Assert.Equal(11, set.RepMax);
        Assert.Equal("3", set.Rir);
    }

    private static async Task<SessionView> Prepare(Harness h)
    {
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", "", null));
        var id = await h.ExerciseId("bench");
        var program = await h.Programs.Create(new ProgramInput("Program", [
            new ProgramWorkoutInput(1, "First", "Push", null,
                [Harness.Exercise(id, "Bench", Harness.Set(8, 10) with { Rir = "2" }) with { Note = "Original" }]),
            new ProgramWorkoutInput(2, "Second", "Push", null,
                [Harness.Exercise(id, "Bench", Harness.Set(6, 8) with { Rir = "3" }) with { Note = "Later" }])
        ]), true, null, default);
        var session = await h.Workouts.Start(program.Workouts.Single(d => d.Week == 1).Id, null, default);
        var exercise = session.Exercises[0];
        return await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(id, exercise.Name, "Workout note", exercise.Prescription,
                [new SetInput(60, 8, 8, true, Id: exercise.Sets[0].Id)], Id: exercise.Id)], session.Revision, null), default);
    }
}
