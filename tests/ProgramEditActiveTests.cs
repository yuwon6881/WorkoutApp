using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;
using static Workout.Tests.ProgramEditRig;

namespace Workout.Tests;

/// Editing a program that holds the active slot: everything the run has not reached can change,
/// while the weeks it left and the days it passed stay exactly as they were.
public class ProgramEditActiveTests
{
    // ---------------------------------------------------------------- programs outside the slot

    [Fact]
    public async Task A_library_program_can_be_edited_freely()
    {
        await using var rig = await Ready();
        var program = await Library(rig);
        var wk1A = Day(program, "W1 A");

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            Replace(days, wk1A.Id, day => Rename(day, "Renamed")).Where(day => day.Name != "W3 B").ToList(), "Renamed plan"), default);

        Assert.Equal("Renamed plan", edited.Name);
        Assert.Contains(edited.Workouts, day => day.Name == "Renamed");
        Assert.DoesNotContain(edited.Workouts, day => day.Name == "W3 B");
        Assert.Equal(program.Revision + 1, edited.Revision);
        Assert.False(edited.Active);
        Assert.Null(edited.Progress);
        Assert.False(await rig.H.Db.ProgramRuns.AnyAsync());
    }

    [Fact]
    public async Task A_library_program_can_gain_and_lose_whole_weeks()
    {
        await using var rig = await Ready();
        var program = await Library(rig);

        var grown = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            [.. days, NewDay(4, "W4 A", rig.Bench), NewDay(4, "W4 B", rig.Bench)]), default);
        Assert.Equal(4, grown.Weeks);
        Assert.Equal(9, grown.Workouts.Count);

        var shrunk = await rig.H.ProgramEditor.UpdateProgram(grown.Id, With(grown, days => days.Where(day => day.Week <= 2).ToList()), default);
        Assert.Equal(2, shrunk.Weeks);
        Assert.Equal(5, shrunk.Workouts.Count);
        Assert.Equal(5, await rig.H.Db.Templates.CountAsync(day => day.ProgramId == program.Id));
        // The rest day has no exercises, so four training days leave four exercise rows.
        Assert.Equal(4, await rig.H.Db.TemplateExercises.CountAsync(row => rig.H.Db.Templates.Any(day => day.Id == row.TemplateId && day.ProgramId == program.Id)));
    }

    [Fact]
    public async Task Saving_without_changes_writes_nothing_and_keeps_the_revision()
    {
        await using var rig = await Ready();
        var program = await Active(rig);

        var saved = await rig.H.ProgramEditor.UpdateProgram(program.Id, Unchanged(program), default);

        Assert.Equal(program.Revision, saved.Revision);
        Assert.All(saved.Workouts, day => Assert.Equal(program.Workouts.Single(original => original.Id == day.Id).Revision, day.Revision));
    }

    // ---------------------------------------------------------------- an active run

    [Fact]
    public async Task An_active_program_with_nothing_done_is_fully_editable()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var wk1A = Day(program, "W1 A");

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            Replace(days, wk1A.Id, day => day with
            {
                Name = "Heavy A",
                Exercises = [Harness.Exercise(rig.Squat, "Back squat", Harness.Set(5, 5))]
            })), default);

        Assert.Equal("Heavy A", Day(edited, "Heavy A").Name);
        Assert.Equal("Back squat", Day(edited, "Heavy A").Exercises.Single().SourceName);
        Assert.Equal(1, edited.Progress!.CurrentWeek);
        Assert.Equal(0, edited.Progress.PassedDays);
    }

    [Fact]
    public async Task A_passed_day_cannot_be_edited_but_pending_days_can()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 A").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        var done = Day(program, "W1 A");

        var refusal = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, done.Id, day => Rename(day, "Tampered"))), default));
        Assert.Contains("already past", refusal.Message);

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days => Replace(days, done.Id, day => day with
        {
            Exercises = [Harness.Exercise(rig.Squat, "Back squat", Harness.Set(3, 3))]
        })), default));

        var pending = Day(program, "W1 B");
        var saved = await rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, pending.Id, day => Rename(day, "Pending renamed"))), default);
        Assert.Equal("Pending renamed", Day(saved, "Pending renamed").Name);
        Assert.Equal("W1 A", Day(saved, "W1 A").Name);
        Assert.Equal(done.Revision, Day(saved, "W1 A").Revision);
        Assert.Equal(done.Exercises.Single().SetsToJson(), Day(saved, "W1 A").Exercises.Single().SetsToJson());
    }

    [Fact]
    public async Task A_passed_day_cannot_be_deleted_even_if_it_was_only_skipped()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        program = await rig.H.Programs.Skip(program.Id, Day(program, "W1 A").Id, Action(program), default);
        var skipped = Day(program, "W1 A");

        var refusal = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => days.Where(day => day.Id != skipped.Id).ToList()), default));
        Assert.Contains("can't be removed", refusal.Message);
        Assert.True(await rig.H.Db.Templates.AnyAsync(day => day.Id == skipped.Id));
    }

    [Fact]
    public async Task A_passed_rest_day_is_locked_and_a_pending_rest_day_is_not()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var rest = Day(program, "W1 Rest");

        var removable = await rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => days.Where(day => day.Id != rest.Id).ToList()), default);
        Assert.DoesNotContain(removable.Workouts, day => day.Name == "W1 Rest");

        // Put it back, pass it, and it is history.
        var restored = await rig.H.ProgramEditor.UpdateProgram(removable.Id,
            With(removable, days => [.. days, NewDay(1, "Rest again", rig.Bench, 1) with { IsRestDay = true, Exercises = [] }]), default);
        var newRest = Day(restored, "Rest again");
        var passed = await rig.H.Programs.AcknowledgeRest(restored.Id, newRest.Id, Action(restored), default);

        await Refused(rig.H.ProgramEditor.UpdateProgram(passed.Id,
            With(passed, days => days.Where(day => day.Id != newRest.Id).ToList()), default));
        await Refused(rig.H.ProgramEditor.UpdateProgram(passed.Id,
            With(passed, days => Replace(days, newRest.Id, day => Rename(day, "Edited rest"))), default));
    }

    [Fact]
    public async Task Past_days_may_be_pushed_down_by_a_new_day_but_never_reordered()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 B").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        var done = Day(program, "W1 B");

        // A new day placed first shifts the finished one down but leaves it intact.
        var inserted = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            [NewDay(1, "Warm-up day", rig.Bench, 1), .. days]), default);
        var week = inserted.Workouts.Where(day => day.Week == 1).OrderBy(day => day.Position).Select(day => day.Name).ToList();
        Assert.Equal(["Warm-up day", "W1 A", "W1 B", "W1 Rest"], week);
        Assert.Equal(done.Id, Day(inserted, "W1 B").Id);
        Assert.Equal(1, inserted.Progress!.CurrentWeek);
        Assert.Equal(ProgramDayStatus.Completed, inserted.Progress.Days.Single(entry => entry.TemplateId == done.Id).Status);

        // Two finished days swapping places is a reorder of history.
        await Complete(rig.H, Day(inserted, "W1 A").Id);
        var both = await rig.H.Programs.Get(inserted.Id, default);
        var swapped = With(both, days =>
        {
            var a = days.Single(day => day.Name == "W1 A");
            var b = days.Single(day => day.Name == "W1 B");
            return days.Select(day => day.Id == a.Id ? b : day.Id == b.Id ? a : day).ToList();
        });
        var refusal = await Refused(rig.H.ProgramEditor.UpdateProgram(both.Id, swapped, default));
        Assert.Contains("reordered", refusal.Message);
    }

    [Fact]
    public async Task Weeks_before_the_current_week_are_sealed()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 A").Id);
        await Complete(rig.H, Day(program, "W1 B").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        program = await rig.H.Programs.AcknowledgeRest(program.Id, Day(program, "W1 Rest").Id, Action(program), default);
        Assert.Equal(2, program.Progress!.CurrentWeek);

        var sneaky = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => [.. days, NewDay(1, "Sneaky", rig.Bench, 1)]), default));
        Assert.Contains("Weeks before Week 2", sneaky.Message);
        var dropped = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => days.Where(day => day.Week != 1).Select(day => day with { Week = day.Week - 1, PhaseWeek = day.PhaseWeek - 1 }).ToList()), default));
        Assert.Contains("already past", dropped.Message);
        var moved = Day(program, "W2 A");
        var intoPast = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, moved.Id, day => day with { Week = 1, PhaseWeek = 1 })), default));
        Assert.Contains("Weeks before Week 2", intoPast.Message);
        var outOfPast = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, Day(program, "W1 A").Id, day => day with { Week = 2, PhaseWeek = 2 })), default));
        Assert.Contains("already past", outOfPast.Message);
        var edited = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, Day(program, "W1 B").Id, day => day with { Focus = "Different" })), default));
        Assert.Contains("W1 B", edited.Message);
        var retimed = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, Day(program, "W1 B").Id, day => day with
            {
                Exercises = [day.Exercises.Single() with { Sets = [Harness.Set(1, 1)] }]
            })), default));
        Assert.Contains("W1 B", retimed.Message);

        // The weeks after it stay open.
        var saved = await rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, Day(program, "W3 A").Id, day => Rename(day, "Later A"))), default);
        Assert.Equal("Later A", Day(saved, "Later A").Name);
        Assert.Equal(3, saved.Weeks);
    }

    [Fact]
    public async Task Future_weeks_can_be_added_removed_and_rewritten_while_history_survives()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 A").Id);
        program = await rig.H.Programs.Get(program.Id, default);

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            [.. days.Where(day => day.Week < 3), NewDay(3, "New W3", rig.Squat), NewDay(4, "W4 A", rig.Bench), NewDay(5, "W5 A", rig.Bench)]), default);

        Assert.Equal(5, edited.Weeks);
        Assert.DoesNotContain(edited.Workouts, day => day.Name is "W3 A" or "W3 B");
        Assert.Contains(edited.Workouts, day => day.Name == "W5 A");
        Assert.Single((await rig.H.Workouts.History(0, 10, default)).Sessions);
        Assert.Equal(1, edited.Progress!.PassedDays);
        Assert.Contains(Day(edited, "W1 A").Id, edited.CompletedTemplateIds);
    }

    [Fact]
    public async Task A_new_day_in_the_current_week_joins_the_run_as_pending()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 A").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        var before = program.Progress!;

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            [.. days, NewDay(1, "Bonus", rig.Bench, 1)]), default);

        var progress = edited.Progress!;
        Assert.Equal(before.TotalDays + 1, progress.TotalDays);
        Assert.Equal(before.PassedDays, progress.PassedDays);
        var bonus = Day(edited, "Bonus");
        Assert.Equal(ProgramDayStatus.Pending, progress.Days.Single(entry => entry.TemplateId == bonus.Id).Status);
        Assert.Equal(before.RunId, progress.RunId);
    }

    [Fact]
    public async Task Removing_the_last_pending_days_of_a_week_advances_the_run()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 A").Id);
        await Complete(rig.H, Day(program, "W1 B").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        var rest = Day(program, "W1 Rest");

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            days.Where(day => day.Id != rest.Id).ToList()), default);

        Assert.Equal(2, edited.Progress!.CurrentWeek);
        Assert.Equal(ProgramLifecycle.Active, edited.LifecycleStatus);
        Assert.NotNull(edited.NextTemplateId);
    }

    [Fact]
    public async Task Removing_every_remaining_day_of_the_last_week_finishes_the_run()
    {
        await using var rig = await Ready();
        var program = await rig.H.Programs.Create(new ProgramInput("Two weeks",
            [Train(1, "A", rig.Bench, 1), Train(2, "B", rig.Bench, 2), Train(2, "C", rig.Bench, 2)]), true, null, default);
        await Complete(rig.H, Day(program, "A").Id);
        await Complete(rig.H, Day(program, "B").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        Assert.Equal(2, program.Progress!.CurrentWeek);

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            days.Where(day => day.Name != "C").ToList()), default);

        Assert.Equal(ProgramLifecycle.Completed, edited.LifecycleStatus);
        Assert.Equal(2, edited.Workouts.Count);
        Assert.True(edited.Active);
    }

    [Fact]
    public async Task The_current_week_cannot_be_left_without_any_day()
    {
        await using var rig = await Ready();
        var program = await rig.H.Programs.Create(new ProgramInput("Two weeks",
            [Train(1, "A", rig.Bench, 1), Train(2, "B", rig.Bench, 2)]), true, null, default);
        await Complete(rig.H, Day(program, "A").Id);
        program = await rig.H.Programs.Get(program.Id, default);

        var refusal = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            days.Where(day => day.Week == 1).ToList()), default), 422);
        Assert.Contains("Week 2", refusal.Message);
    }

    [Fact]
    public async Task A_pending_day_moves_out_of_and_into_the_current_week()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var wk1B = Day(program, "W1 B");
        var wk2A = Day(program, "W2 A");

        var moved = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            Replace(Replace(days, wk1B.Id, day => day with { Week = 2, PhaseWeek = 2 }), wk2A.Id, day => day with { Week = 1, PhaseWeek = 1 })), default);

        var progress = moved.Progress!;
        Assert.DoesNotContain(progress.Days, entry => entry.TemplateId == wk1B.Id);
        Assert.Contains(progress.Days, entry => entry.TemplateId == wk2A.Id && entry.Status == ProgramDayStatus.Pending);
        Assert.Equal(Day(moved, "W1 B").Week, 2);
        Assert.Equal(Day(moved, "W2 A").Week, 1);
        Assert.Equal(3, progress.TotalDays);
        // No orphaned progress rows remain for the day that left the week.
        Assert.False(await rig.H.Db.ProgramDayProgresses.AnyAsync(row => row.TemplateId == wk1B.Id));
    }

    [Fact]
    public async Task A_day_with_an_open_workout_can_be_changed_but_not_removed_or_moved_away()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var open = Day(program, "W1 A");
        await rig.H.Workouts.Start(open.Id, null, default);

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => days.Where(day => day.Id != open.Id).ToList()), default));
        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, open.Id, day => day with { Week = 2, PhaseWeek = 2 })), default));

        var saved = await rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, open.Id, day => Rename(day, "A (adjusted)"))), default);
        Assert.Equal("A (adjusted)", Day(saved, "A (adjusted)").Name);
        Assert.True(await rig.H.Db.Workouts.AnyAsync(workout => workout.Active && workout.TemplateId == open.Id));
    }

    [Fact]
    public async Task A_reset_week_unlocks_the_days_it_cleared()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 A").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        var done = Day(program, "W1 A");
        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, done.Id, day => Rename(day, "Nope"))), default));

        var reset = new ProgramWeekResetInput(program.Revision, program.Progress!.RunId, 1, 1, "RESET", Guid.NewGuid());
        program = await rig.H.Programs.ResetWeek(program.Id, reset, default);

        var saved = await rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, done.Id, day => Rename(day, "Allowed again"))), default);
        Assert.Equal("Allowed again", Day(saved, "Allowed again").Name);
    }

    [Fact]
    public async Task A_finished_run_cannot_be_edited()
    {
        await using var rig = await Ready();
        var program = await rig.H.Programs.Create(new ProgramInput("One day", [Train(1, "Only", rig.Bench, 1)]), true, null, default);
        await Complete(rig.H, Day(program, "Only").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        Assert.Equal(ProgramLifecycle.Completed, program.LifecycleStatus);

        var refusal = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => [.. days, NewDay(2, "More", rig.Bench, 2)]), default));
        Assert.Contains("finished", refusal.Message);
    }

    // ---------------------------------------------------------------- concurrency, identity, tenancy

    [Fact]
    public async Task A_stale_revision_and_a_replayed_request_are_rejected()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var stale = With(program, days => Replace(days, Day(program, "W3 A").Id, day => Rename(day, "First")));

        var saved = await rig.H.ProgramEditor.UpdateProgram(program.Id, stale, default);
        Assert.Equal("First", Day(saved, "First").Name);

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, stale, default));

        // A refresh that resends identical content is a no-op, not an error.
        var again = await rig.H.ProgramEditor.UpdateProgram(program.Id, stale with { Revision = saved.Revision }, default);
        Assert.Equal(saved.Revision, again.Revision);

        // The same request id reused for a different change has already been spent.
        var reused = With(saved, days => Replace(days, Day(saved, "W3 B").Id, day => Rename(day, "Second"))) with { IdempotencyId = stale.IdempotencyId };
        var error = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, reused, default));
        Assert.Contains("already saved", error.Message);
        Assert.DoesNotContain((await rig.H.Programs.Get(program.Id, default)).Workouts, day => day.Name == "Second");
        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, stale with { Revision = null, IdempotencyId = Guid.NewGuid() }, default));
    }

    [Fact]
    public async Task Unknown_and_foreign_day_ids_become_new_days_and_never_adopt_other_rows()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var other = await rig.H.Templates.Create(Harness.Template("Standalone", Harness.Exercise(rig.Bench, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            [.. days, NewDay(3, "Fresh", rig.Bench) with { Id = other.Id }, NewDay(3, "Fresh 2", rig.Bench) with { Id = null }]), default);

        Assert.Contains(edited.Workouts, day => day.Name == "Fresh" && day.Id != other.Id);
        Assert.Contains(edited.Workouts, day => day.Name == "Fresh 2");
        var standalone = await rig.H.Templates.Get(other.Id, default);
        Assert.Null(standalone.ProgramId);
        Assert.Equal("Standalone", standalone.Name);
    }

    [Fact]
    public async Task The_same_day_cannot_appear_twice()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var wk3 = ToDay(Day(program, "W3 A"));

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days => [.. days, wk3]), default), 400);
    }

    [Fact]
    public async Task Another_users_program_is_not_found()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await rig.H.SignIn("bob");

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, Unchanged(program), default), 404);
    }

    // ---------------------------------------------------------------- content rules

    [Fact]
    public async Task Edited_days_must_satisfy_the_same_rules_as_a_new_program()
    {
        await using var rig = await Ready();
        var program = await Active(rig);

        var unmapped = NewDay(3, "Unmapped", rig.Bench) with
        {
            Exercises = [new TemplateExerciseInput(null, "Mystery lift", null, [Harness.Set(8, 10)])]
        };
        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days => [.. days, unmapped]), default), 422);

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => [.. days, NewDay(5, "Gap", rig.Bench, 5)]), default), 422);

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => days.Where(day => day.Week != 2).ToList()), default), 422);

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => [.. days, NewDay(3, "Empty", rig.Bench) with { Exercises = [] }]), default), 400);

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => [.. days, NewDay(3, "Rest with work", rig.Bench) with { IsRestDay = true }]), default), 400);

        var crowded = Enumerable.Range(0, ProgramLimits.MaxDaysPerWeek + 1).Select(index => NewDay(3, $"Extra {index}", rig.Bench)).ToList();
        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days => [.. days, .. crowded]), default), 422);

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days => days, " "), default), 400);
        Assert.Equal(program.Revision, (await rig.H.Programs.Get(program.Id, default)).Revision);
    }

    [Fact]
    public async Task Bodyweight_resistance_modes_survive_an_edit_that_never_touched_the_day()
    {
        await using var rig = await Ready();
        var assisted = Harness.Set(8, 10) with { ResistanceMode = ResistanceModes.Assistance };
        var program = await rig.H.Programs.Create(new ProgramInput("Assisted",
        [
            new ProgramWorkoutInput(1, "Pull", "Pull", null, [Harness.Exercise(rig.Bench, "Bench press", assisted)], "Block 1", null, 1),
            Train(2, "Later", rig.Bench, 2)
        ]), true, null, default);

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            Replace(days, Day(program, "Later").Id, day => Rename(day, "Later renamed"))), default);

        Assert.Equal(ResistanceModes.Assistance, Day(edited, "Pull").Exercises.Single().Sets.Single().ResistanceMode);
    }

    [Fact]
    public async Task Exercise_slot_identity_is_kept_for_edited_exercises()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var target = Day(program, "W3 A");
        var slot = target.Exercises.Single().SlotKey;

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            Replace(days, target.Id, day => day with
            {
                Exercises = [day.Exercises.Single() with { Sets = [Harness.Set(4, 6)], Note = "Pause reps" }]
            })), default);

        var exercise = Day(edited, "W3 A").Exercises.Single();
        Assert.Equal(slot, exercise.SlotKey);
        Assert.Equal("Pause reps", exercise.Note);
        Assert.Equal(4, exercise.Sets.Single().RepMin);
        Assert.Equal(target.Revision + 1, Day(edited, "W3 A").Revision);
    }

    // ---------------------------------------------------------------- phases and blocks

    [Fact]
    public async Task Phases_that_were_already_trained_keep_their_identity_when_later_weeks_change()
    {
        await using var rig = await Ready();
        var program = await rig.H.Programs.Create(new ProgramInput("Blocks",
        [
            Train(1, "A1", rig.Bench, 1, "Base"), Train(2, "A2", rig.Bench, 2, "Base"),
            Train(3, "B1", rig.Bench, 1, "Peak"), Train(4, "B2", rig.Bench, 2, "Peak")
        ]), true, null, default);
        await Complete(rig.H, Day(program, "A1").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        var baseBefore = program.Phases!.Single(phase => phase.Block == "Base").Id;
        var peakBefore = program.Phases!.Single(phase => phase.Block == "Peak").Id;

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            [.. days, NewDay(5, "B3", rig.Bench, 3, "Peak"), NewDay(6, "Deload", rig.Bench, 1, "Deload")]), default);

        Assert.Equal(3, edited.Phases!.Count);
        Assert.Equal(baseBefore, edited.Phases.Single(phase => phase.Block == "Base").Id);
        var peak = edited.Phases.Single(phase => phase.Block == "Peak");
        Assert.Equal(peakBefore, peak.Id);
        Assert.Equal((3, 5), (peak.WeekFrom, peak.WeekTo));
        Assert.Equal(["Base", "Peak", "Deload"], edited.Phases.OrderBy(phase => phase.WeekFrom).Select(phase => phase.Block));
        Assert.All(await rig.H.Db.Templates.Where(day => day.ProgramId == program.Id).ToListAsync(),
            day => Assert.Contains(edited.Phases, phase => phase.Id == day.ProgramPhaseId));
    }

    [Fact]
    public async Task A_block_that_contains_a_passed_day_cannot_be_renamed()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 A").Id);
        program = await rig.H.Programs.Get(program.Id, default);

        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => days.Select(day => day with { Block = "Renamed block" }).ToList()), default));

        // A later block can be introduced instead.
        var saved = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            days.Select(day => day.Week == 3 ? day with { Block = "Peak", PhaseWeek = 1 } : day).ToList()), default);
        Assert.Equal(2, saved.Phases!.Count);
    }

    // ---------------------------------------------------------------- existing edit paths stay consistent

    [Fact]
    public async Task Editing_a_single_day_through_the_template_api_respects_the_same_lock()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 A").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        var done = Day(program, "W1 A");
        var pending = Day(program, "W1 B");

        var input = (TemplateView day, string name) => new TemplateInput(name, day.Focus, day.Note,
            day.Exercises.Select(exercise => new TemplateExerciseInput(exercise.ExerciseId, exercise.SourceName, exercise.Note,
                exercise.Sets, exercise.SequenceGroup, exercise.Substitutions, exercise.SourcePage, exercise.SlotKey)).ToList(),
            day.Revision, Guid.NewGuid(), day.Block, day.Phase, day.PhaseWeek, day.IsRestDay);

        await Refused(rig.H.Templates.Update(done.Id, input(done, "Changed"), default));
        await Refused(rig.H.Templates.RestoreTemplate(done.Id, done.Revision, Guid.NewGuid(), default));
        var updated = await rig.H.Templates.Update(pending.Id, input(pending, "Pending changed"), default);
        Assert.Equal("Pending changed", updated.Name);

        // Days of weeks before the current one are locked as well, whatever their status rows say.
        await Complete(rig.H, pending.Id);
        program = await rig.H.Programs.Get(program.Id, default);
        program = await rig.H.Programs.AcknowledgeRest(program.Id, Day(program, "W1 Rest").Id, Action(program), default);
        Assert.Equal(2, program.Progress!.CurrentWeek);
        await Refused(rig.H.Templates.Update(done.Id, input(Day(program, "W1 A"), "Late"), default));
    }

    [Fact]
    public async Task A_phase_wide_swap_leaves_skipped_and_earlier_week_days_alone()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        program = await rig.H.Programs.Skip(program.Id, Day(program, "W1 A").Id, Action(program), default);
        var skipped = Day(program, "W1 A");
        var target = Day(program, "W1 B");

        var swapped = await rig.H.Templates.Swap(target.Id, new TemplateSubstitutionInput(target.Exercises.Single().Id, null,
            rig.Squat, "Back squat", SubstitutionScope.Phase, target.Revision, Guid.NewGuid()), default);

        Assert.DoesNotContain(swapped.AffectedSlots, slot => slot.TemplateId == skipped.Id);
        Assert.Contains(swapped.AffectedSlots, slot => slot.TemplateId == Day(program, "W2 A").Id);
        var untouched = await rig.H.Templates.Get(skipped.Id, default);
        Assert.Equal("Bench press", untouched.Exercises.Single().SourceName);
    }

    [Fact]
    public async Task Finishing_a_workout_never_carries_plan_changes_into_past_days()
    {
        await using var rig = await Ready();
        var program = await rig.H.Programs.Create(new ProgramInput("Carry",
        [
            Train(1, "Done day", rig.Bench, 1), Train(1, "Today", rig.Bench, 1), Train(2, "Ahead", rig.Bench, 2)
        ]), true, null, default);
        await Complete(rig.H, Day(program, "Done day").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        var done = Day(program, "Done day");
        var ahead = Day(program, "Ahead");

        var session = await rig.H.Workouts.Start(Day(program, "Today").Id, null, default);
        var exercise = session.Exercises.Single();
        session = await rig.H.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(rig.Bench, exercise.Name, "Carry me", exercise.Prescription,
                [new SetInput(60, 8, 8, true, Id: exercise.Sets[0].Id)], Id: exercise.Id)], session.Revision, null), default);
        var preview = await rig.H.Workouts.PreviewFinishPlan(session.Id, default);

        Assert.DoesNotContain(done.Id, preview.DayRevisions.Keys);
        Assert.Contains(ahead.Id, preview.DayRevisions.Keys);
        Assert.Equal(1, preview.Counts.Program);

        await rig.H.Workouts.Finish(session.Id, session.Revision, default,
            planUpdate: new FinishPlanUpdateInput("program", preview.ChangesHash, preview.ProgramRevision, preview.DayRevisions));

        Assert.Equal("", (await rig.H.Templates.Get(done.Id, default)).Exercises.Single().Note);
        Assert.Equal("Carry me", (await rig.H.Templates.Get(ahead.Id, default)).Exercises.Single().Note);
        Assert.Equal(done.Revision, (await rig.H.Templates.Get(done.Id, default)).Revision);
    }
}

internal static class TemplateExerciseViewExtensions
{
    public static string SetsToJson(this TemplateExerciseView exercise) => Json.Write(exercise.Sets);
}
