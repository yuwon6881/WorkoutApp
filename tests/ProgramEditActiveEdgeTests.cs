using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;
using static Workout.Tests.ProgramEditRig;

namespace Workout.Tests;

/// The awkward corners of editing a program mid-run: repaired legacy runs, reset weeks, imported
/// programs, and structural edits that shuffle blocks and weeks the run has not reached.
public class ProgramEditActiveEdgeTests
{
    [Fact]
    public async Task A_legacy_active_program_without_run_rows_is_repaired_before_it_is_compared()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 A").Id);
        rig.H.Db.ProgramDayProgresses.RemoveRange(rig.H.Db.ProgramDayProgresses);
        rig.H.Db.ProgramRuns.RemoveRange(rig.H.Db.ProgramRuns);
        await rig.H.Db.SaveChangesAsync();
        rig.H.Db.ChangeTracker.Clear();
        program = await rig.H.Programs.Get(program.Id, default);

        // The finished workout is rebuilt into the repaired run, so the day is locked again.
        var refusal = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            Replace(days, Day(program, "W1 A").Id, day => Rename(day, "Tampered"))), default));
        Assert.Contains("W1 A", refusal.Message);
        var saved = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            Replace(days, Day(program, "W1 B").Id, day => Rename(day, "Fine"))), default);
        Assert.Equal("Fine", Day(saved, "Fine").Name);
    }

    [Fact]
    public async Task Deleting_a_day_reset_back_to_pending_keeps_its_finished_session_in_history()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var target = Day(program, "W1 A");
        await Complete(rig.H, target.Id);
        program = await rig.H.Programs.Get(program.Id, default);
        program = await rig.H.Programs.ResetWeek(program.Id,
            new ProgramWeekResetInput(program.Revision, program.Progress!.RunId, 1, 1, "RESET", Guid.NewGuid()), default);

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => days.Where(day => day.Id != target.Id).ToList()), default);

        Assert.DoesNotContain(edited.Workouts, day => day.Id == target.Id);
        Assert.False(await rig.H.Db.ProgramDayProgresses.AnyAsync(row => row.TemplateId == target.Id));
        var history = await rig.H.Workouts.History(0, 10, default);
        var session = Assert.Single(history.Sessions);
        Assert.False(session.Active);
        Assert.Null((await rig.H.Db.Workouts.SingleAsync(workout => workout.Id == session.Id)).TemplateId);
        Assert.Null((await rig.H.Db.Workouts.SingleAsync(workout => workout.Id == session.Id)).ProgramDayProgressId);
    }

    [Fact]
    public async Task An_imported_program_may_leave_effort_unstated_but_a_built_one_may_not()
    {
        await using var rig = await Ready();
        var unstated = Harness.Set(8, 10, rpe: null);
        var imported = await rig.H.Programs.Create(new ProgramInput("Imported",
            [new ProgramWorkoutInput(1, "Day", "Push", null, [Harness.Exercise(rig.Bench, "Bench press", unstated)], "Block 1", null, 1)]),
            true, Guid.NewGuid(), default);
        var built = await rig.H.Programs.Create(new ProgramInput("Built",
            [Train(1, "Day", rig.Bench, 1)]), false, null, default);
        ProgramEditDayInput Loose(int week) => NewDay(week, $"Added {week}", rig.Bench) with
        {
            Exercises = [Harness.Exercise(rig.Bench, "Bench press", unstated)]
        };

        var saved = await rig.H.ProgramEditor.UpdateProgram(imported.Id, With(imported, days => [.. days, Loose(2)]), default);
        Assert.Contains(saved.Workouts, day => day.Name == "Added 2");

        await Refused(rig.H.ProgramEditor.UpdateProgram(built.Id, With(built, days => [.. days, Loose(2)]), default), 400);
    }

    [Fact]
    public async Task A_block_inserted_between_future_blocks_resequences_phases_without_clashing()
    {
        await using var rig = await Ready();
        var program = await rig.H.Programs.Create(new ProgramInput("Blocks",
        [
            Train(1, "A", rig.Bench, 1, "One"), Train(2, "B", rig.Bench, 1, "Two"), Train(3, "C", rig.Bench, 1, "Three")
        ]), true, null, default);
        await Complete(rig.H, Day(program, "A").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        var two = program.Phases!.Single(phase => phase.Block == "Two").Id;
        var three = program.Phases!.Single(phase => phase.Block == "Three").Id;

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days => days.Select(day => day.Name switch
        {
            "B" => day with { Week = 3, PhaseWeek = 1 },
            "C" => day with { Week = 4, PhaseWeek = 1 },
            _ => day
        }).Concat([NewDay(2, "Inserted", rig.Bench, 1, "Between")]).ToList()), default);

        Assert.Equal(["One", "Between", "Two", "Three"], edited.Phases!.OrderBy(phase => phase.Position()).Select(phase => phase.Block));
        Assert.Equal(two, edited.Phases.Single(phase => phase.Block == "Two").Id);
        Assert.Equal(three, edited.Phases.Single(phase => phase.Block == "Three").Id);
        Assert.Equal(4, edited.Weeks);
    }

    [Fact]
    public async Task Future_weeks_can_swap_places_and_keep_their_day_identities()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var two = program.Workouts.Where(day => day.Week == 2).Select(day => day.Id).ToHashSet();
        var three = program.Workouts.Where(day => day.Week == 3).Select(day => day.Id).ToHashSet();

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days => days.Select(day =>
            two.Contains(day.Id!.Value) ? day with { Week = 3, PhaseWeek = 3 }
            : three.Contains(day.Id!.Value) ? day with { Week = 2, PhaseWeek = 2 } : day).ToList()), default);

        Assert.All(edited.Workouts.Where(day => two.Contains(day.Id)), day => Assert.Equal(3, day.Week));
        Assert.All(edited.Workouts.Where(day => three.Contains(day.Id)), day => Assert.Equal(2, day.Week));
        Assert.Equal(program.Workouts.Count, edited.Workouts.Count);
    }

    [Fact]
    public async Task A_duplicated_week_keeps_exercise_slots_independent_per_day()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var copies = program.Workouts.Where(day => day.Week == 3).Select(ToDay)
            .Select(day => day with { Id = Guid.NewGuid(), Week = 4, PhaseWeek = 4, Name = day.Name.Replace("W3", "W4") }).ToList();

        var edited = await rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days => [.. days, .. copies]), default);

        Assert.Equal(4, edited.Weeks);
        var original = Day(edited, "W3 A").Exercises.Single().SlotKey;
        Assert.Equal(original, Day(edited, "W4 A").Exercises.Single().SlotKey);
        Assert.NotEqual(Day(edited, "W3 A").Id, Day(edited, "W4 A").Id);
    }

    [Fact]
    public async Task A_program_cannot_grow_past_the_day_limit()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var tooMany = Enumerable.Range(4, 60).SelectMany(week => Enumerable.Range(0, 7).Select(index => NewDay(week, $"W{week}-{index}", rig.Bench))).ToList();

        var refusal = await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days => [.. days, .. tooMany]), default), 400);
        Assert.Contains("400", refusal.Message);
    }

    [Fact]
    public async Task A_save_that_fails_midway_changes_nothing()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var before = await rig.H.Db.Templates.AsNoTracking().Where(day => day.ProgramId == program.Id)
            .OrderBy(day => day.Week).ThenBy(day => day.Position).Select(day => new { day.Id, day.Name, day.Week, day.Revision }).ToListAsync();

        var unmapped = NewDay(3, "Unmapped", rig.Bench) with
        {
            Exercises = [new TemplateExerciseInput(null, "Mystery lift", null, [Harness.Set(8, 10)])]
        };
        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id, With(program, days =>
            [.. days.Where(day => day.Name != "W2 B").Select(day => day.Name == "W3 A" ? Rename(day, "Edited") : day), unmapped], "New name"), default), 422);

        rig.H.Db.ChangeTracker.Clear();
        var after = await rig.H.Db.Templates.AsNoTracking().Where(day => day.ProgramId == program.Id)
            .OrderBy(day => day.Week).ThenBy(day => day.Position).Select(day => new { day.Id, day.Name, day.Week, day.Revision }).ToListAsync();
        Assert.Equal(before, after);
        Assert.Equal(program.Name, (await rig.H.Programs.Get(program.Id, default)).Name);
    }

    [Fact]
    public async Task Moving_a_program_out_of_the_slot_unlocks_it_again()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        await Complete(rig.H, Day(program, "W1 A").Id);
        program = await rig.H.Programs.Get(program.Id, default);
        await Refused(rig.H.ProgramEditor.UpdateProgram(program.Id,
            With(program, days => Replace(days, Day(program, "W1 A").Id, day => Rename(day, "Nope"))), default));

        var parked = await rig.H.Programs.SetActive(program.Id, false, program.Revision, default);
        var saved = await rig.H.ProgramEditor.UpdateProgram(parked.Id,
            With(parked, days => Replace(days, Day(parked, "W1 A").Id, day => Rename(day, "Now allowed"))), default);

        Assert.Equal("Now allowed", Day(saved, "Now allowed").Name);
    }

    [Fact]
    public async Task The_json_the_browser_sends_binds_to_the_edit_input_and_saves()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var target = Day(program, "W3 A");
        var slot = target.Exercises.Single().SlotKey;

        // Field for field what the editor's payload builder produces, including nulls and a new day.
        object Exercise(Guid? exerciseId, string name, Guid? slotKey) => new
        {
            exerciseId, sourceName = name, note = (string?)null, sequenceGroup = (string?)null, substitutions = Array.Empty<string>(),
            sourcePage = (int?)null, slotKey, restSeconds = 90, demoUrl = (string?)null, demoLinks = (object?)null,
            sets = new[]
            {
                new
                {
                    repMin = (int?)6, repMax = (int?)8, targetRpe = (double?)8.5, restSeconds = (int?)120, tempo = (string?)null,
                    loadText = (string?)null, notes = (string?)null, repsText = (string?)null, restText = (string?)null, rir = (string?)null,
                    warmup = false, repsSource = "userEdited", rpeSource = "userEdited", restSource = "userEdited",
                    resistanceMode = "external", sourcePage = (int?)null
                }
            }
        };
        var wire = JsonSerializer.Serialize(new
        {
            name = "From the browser", revision = program.Revision, idempotencyId = Guid.NewGuid(),
            days = program.Workouts.Select(day => day.Id == target.Id
                ? new { id = (Guid?)day.Id, week = day.Week, name = "Edited", focus = (string?)"Strength", note = (string?)null,
                    block = (string?)"Block 1", phase = (string?)null, phaseWeek = day.PhaseWeek, isRestDay = false, sourcePage = (int?)null,
                    exercises = new[] { Exercise(rig.Squat, "Back squat", slot) } }
                : new { id = (Guid?)day.Id, week = day.Week, name = day.Name, focus = (string?)day.Focus, note = (string?)null,
                    block = (string?)day.Block, phase = (string?)null, phaseWeek = day.PhaseWeek, isRestDay = day.IsRestDay, sourcePage = (int?)null,
                    exercises = day.Exercises.Select(e => Exercise(e.ExerciseId, e.SourceName, e.SlotKey)).ToArray() })
                .Append(new { id = (Guid?)null, week = 3, name = "Brand new", focus = (string?)null, note = (string?)null,
                    block = (string?)"Block 1", phase = (string?)null, phaseWeek = 3, isRestDay = false, sourcePage = (int?)null,
                    exercises = new[] { Exercise(rig.Bench, "Bench press", null) } })
        });

        var input = JsonSerializer.Deserialize<ProgramEditInput>(wire, Json.Options)!;
        var saved = await rig.H.ProgramEditor.UpdateProgram(program.Id, input, default);

        Assert.Equal("From the browser", saved.Name);
        var edited = Day(saved, "Edited");
        Assert.Equal(slot, edited.Exercises.Single().SlotKey);
        Assert.Equal("Back squat", edited.Exercises.Single().SourceName);
        Assert.Equal(6, edited.Exercises.Single().Sets.Single().RepMin);
        Assert.Contains(saved.Workouts, day => day.Name == "Brand new");
        Assert.Equal(8, saved.Workouts.Count);
    }
}

file static class PhaseViewExtensions
{
    public static int Position(this ProgramPhaseView phase) => phase.WeekFrom;
}
