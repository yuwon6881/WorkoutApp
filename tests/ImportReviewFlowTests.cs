using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The review, edit, restore, accept and discard flow over a draft made from an external JSON file.
public sealed class ImportReviewFlowTests
{
    private static async Task<(Harness Harness, ImportService Imports)> Signed(bool seedBench = true)
    {
        var h = await Harness.Create();
        await h.SignIn();
        if (seedBench) await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", null));
        return (h, h.Imports());
    }

    [Fact]
    public async Task An_unmatched_exercise_stays_unresolved_and_blocks_acceptance()
    {
        var (h, imports) = await Signed(seedBench: false);
        await using var _ = h;
        var view = await ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(1));

        Assert.Null(view.Draft!.Workouts.Single().Exercises.Single().ExerciseId);
        Assert.Single(view.Unresolved);
        Assert.False(view.Acceptable);
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Accept(view.Id, default));
        Assert.Equal(409, failure.Status);
        Assert.Empty(await h.Db.Programs.ToListAsync());
    }

    [Fact]
    public async Task Accepting_a_mapped_draft_materializes_a_standby_program_and_removes_the_import()
    {
        var (h, imports) = await Signed();
        await using var _ = h;
        var view = await ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(1));

        var program = await imports.Accept(view.Id, default);

        Assert.Equal("Hypertrophy block", program.Name);
        Assert.False(program.Active);
        Assert.Equal(ProgramLifecycle.Standby, program.LifecycleStatus);
        var workout = Assert.Single(program.Workouts);
        Assert.Equal("Day A", workout.Name);
        var set = workout.Exercises.Single().Sets.Single();
        Assert.Equal((8, 10, 8, 120), (set.RepMin, set.RepMax, set.TargetRpe, set.RestSeconds));
        Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => imports.Get(view.Id, default))).Status);
    }

    [Fact]
    public async Task An_accepted_program_waits_its_turn_when_another_is_already_active()
    {
        var (h, imports) = await Signed();
        await using var _ = h;
        var benchId = await h.ExerciseId("bench");
        await h.Programs.Create(new ProgramInput("Existing",
            [new ProgramWorkoutInput(1, "Day A", null, null, [Harness.Exercise(benchId, "Barbell bench press", Harness.Set(8, 10))])], null), true, null, default);
        var view = await ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(1));

        var program = await imports.Accept(view.Id, default);

        Assert.False(program.Active);
    }

    [Fact]
    public async Task A_reviewer_edit_is_saved_and_can_carry_its_own_provenance()
    {
        var (h, imports) = await Signed();
        await using var _ = h;
        var view = await ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(1));
        var workout = view.Draft!.Workouts.Single();
        var exercise = workout.Exercises.Single();
        var edited = view.Draft with
        {
            Workouts = [workout with { Exercises = [exercise with { Sets = [exercise.Sets[0] with { RepMin = 5, RepMax = 5, RepsSource = "userEdited" }] }] }]
        };

        var saved = await imports.Edit(view.Id, edited, default);

        var set = saved.Draft!.Workouts.Single().Exercises.Single().Sets.Single();
        Assert.Equal(5, set.RepMin);
        Assert.Equal("userEdited", set.RepsSource);
    }

    [Fact]
    public async Task A_discarded_draft_is_gone_and_cannot_be_accepted()
    {
        var (h, imports) = await Signed();
        await using var _ = h;
        var view = await ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(1));

        await imports.Discard(view.Id, default);

        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Accept(view.Id, default));
        Assert.Equal(404, failure.Status);
        Assert.Empty(await h.Db.Imports.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task One_account_cannot_open_another_accounts_import()
    {
        var (h, imports) = await Signed();
        await using var _ = h;
        var view = await ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(1));
        await h.SignIn("bob");

        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Imports().Get(view.Id, default));

        Assert.Equal(404, failure.Status);
    }

    [Fact]
    public async Task Draft_restore_and_exercise_restore_return_to_the_converted_baseline()
    {
        var (h, imports) = await Signed();
        await using var _ = h;
        var ready = await ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(1));
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.False(ready.CanRestoreDraft);
        Assert.Empty(ready.RestorableExerciseLineIds!);
        var original = ready.Draft!.Workouts.Single().Exercises.Single();

        var editedView = await imports.Edit(ready.Id, ready.Draft with
        {
            ProgramName = "Edited Program Name",
            Workouts = [ready.Draft.Workouts.Single() with
            {
                Exercises = [original with
                {
                    SourceName = "Edited Press",
                    Notes = "My coaching cues",
                    Sets = [original.Sets[0] with { RepMin = 12, RepMax = 15, RepsSource = "userEdited" }]
                }]
            }]
        }, default);
        Assert.True(editedView.CanRestoreDraft);
        Assert.Contains(original.LineId, editedView.RestorableExerciseLineIds!);

        var exerciseRestored = await imports.RestoreExercise(ready.Id, original.LineId, editedView.Revision, default);
        var restoredExercise = exerciseRestored.Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal("Barbell bench press", restoredExercise.SourceName);
        Assert.Equal((8, 10), (restoredExercise.Sets[0].RepMin, restoredExercise.Sets[0].RepMax));
        Assert.Equal("Edited Program Name", exerciseRestored.Draft.ProgramName);
        Assert.DoesNotContain(original.LineId, exerciseRestored.RestorableExerciseLineIds!);
        Assert.True(exerciseRestored.CanRestoreDraft);

        var draftRestored = await imports.RestoreDraft(ready.Id, exerciseRestored.Revision, default);
        Assert.Equal("Hypertrophy block", draftRestored.Draft!.ProgramName);
        Assert.False(draftRestored.CanRestoreDraft);
        Assert.Empty(draftRestored.RestorableExerciseLineIds!);

        var stale = await Assert.ThrowsAsync<DomainException>(() => imports.RestoreDraft(ready.Id, 1, default));
        Assert.Equal(409, stale.Status);
    }

    [Fact]
    public async Task Editing_a_flagged_exercise_unblocks_the_program_and_restoring_the_draft_blocks_it_again()
    {
        var (h, imports) = await Signed();
        await using var _ = h;
        // The note prescribes 7+7+7 = 21 reps while the table prints 10: the file contradicts itself, so
        // both values are kept and the reviewer is asked to settle them.
        var exercise = """
            {"sourceName":"Barbell bench press","notes":"FIRST 7 REPS BOTTOM HALF OF ROM, NEXT 7 REPS TOP HALF OF ROM, LAST 7 REPS FULL ROM",
             "sets":[{"repMin":10,"repMax":10,"targetRpe":8,"restSeconds":120}]}
            """;
        var ready = await ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(1, exercises: exercise));
        Assert.Contains(ready.ReviewIssues!, issue => issue.Code == "rep_technique_conflict");
        Assert.False(ready.Acceptable);

        var line = ready.Draft!.Workouts.Single().Exercises.Single();
        var edited = await imports.Edit(ready.Id, ready.Draft with
        {
            Workouts = [ready.Draft.Workouts.Single() with
            {
                Exercises = [line with { Sets = [line.Sets[0] with { TargetRpe = 9, RpeSource = "userEdited" }] }]
            }]
        }, ready.Revision, default);
        Assert.DoesNotContain(edited.ReviewIssues!, issue => issue.Code == "rep_technique_conflict");

        var restored = await imports.RestoreDraft(ready.Id, edited.Revision, default);
        Assert.Contains(restored.ReviewIssues!, issue => issue.Code == "rep_technique_conflict");
        Assert.False(restored.Acceptable);
    }

    [Fact]
    public async Task Reordering_weeks_makes_the_draft_restorable_and_restoring_returns_the_original_order()
    {
        var (h, imports) = await Signed();
        await using var _ = h;
        var ready = await ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(2));
        Assert.False(ready.CanRestoreDraft);

        var edited = await imports.Edit(ready.Id, ready.Draft! with
        {
            Workouts =
            [
                ready.Draft.Workouts[1] with { Week = 1, PhaseWeek = 1 },
                ready.Draft.Workouts[0] with { Week = 2, PhaseWeek = 2 }
            ]
        }, default);
        Assert.True(edited.CanRestoreDraft);

        var restored = await imports.RestoreDraft(ready.Id, edited.Revision, default);
        Assert.False(restored.CanRestoreDraft);
        Assert.Equal(ready.Draft.Workouts[0].LineId, restored.Draft!.Workouts[0].LineId);
    }
}
