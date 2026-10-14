using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ProgramEditorService
{
    /// Saves an edited program in place. Days the lifter already trained or passed in the active
    /// run, and every week before the current one, must come back unchanged; everything else may
    /// be rewritten, added, moved, or removed, and the run's bookkeeping follows the new shape.
    public async Task<ProgramView> UpdateProgram(Guid id, ProgramEditInput input, CancellationToken ct)
    {
        Validation.Require(input?.Days is not null, "A program edit is required.");
        Validation.Name(input!.Name, "Program name");
        Validation.Require(input.Days!.All(day => day?.Exercises is not null), "A workout day is incomplete.");
        // A legacy active program has no run rows until it is read; repair it first so its passed
        // days are known before anything is compared against them.
        await lifecycle.EnsureActiveRun(id, ct);

        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await db.Programs.SingleOrDefaultAsync(candidate => candidate.Id == id, ct);
        Validation.Require(program is not null, "That program no longer exists.", 404);
        Validation.Require(input.Revision == program!.Revision,
            "This program changed on another device. Refresh and try again.", 409);

        var locks = await ProgramLockState.Load(db, id, ct);
        Validation.Require(!locks.RunFinished, "This program has finished its run. Restart it to change its plan.", 409);
        var stored = await db.Templates.Where(day => day.ProgramId == id)
            .OrderBy(day => day.Week).ThenBy(day => day.Position).ToListAsync(ct);
        var storedIds = stored.Select(day => day.Id).ToList();
        var rows = (await db.TemplateExercises.Where(row => storedIds.Contains(row.TemplateId)).ToListAsync(ct))
            .ToLookup(row => row.TemplateId);

        var plan = ProgramEditPlan.Build(input, stored, rows, locks);
        await ValidateChangedDays(plan, requireWorkingRpe: program.SourceImportId is null, ct);

        var removed = stored.Where(day => plan.All(planned => planned.Stored?.Id != day.Id)).ToList();
        var final = new List<WorkoutTemplate>(plan.Count);
        var positions = new Dictionary<int, int>();
        var changed = removed.Count > 0 || program.Name != input.Name.Trim();
        foreach (var planned in plan)
        {
            var week = planned.Locked ? planned.Stored!.Week : planned.Input.Week;
            var position = positions.GetValueOrDefault(week);
            positions[week] = position + 1;
            var placementChanged = false;
            var day = planned.Stored is null ? CreateDay(program, planned.Input, position)
                : planned.Locked ? KeepPastDay(planned.Stored, position)
                : RewriteDay(planned, rows[planned.Stored.Id].ToList(), position, out placementChanged);
            changed |= planned.Stored is null || planned.ContentChanged || placementChanged;
            final.Add(day);
        }
        if (!changed)
        {
            await gate.Commit(ct);
            return await programs.Get(id, ct);
        }

        var removedIds = removed.Select(day => day.Id).ToHashSet();
        foreach (var day in removed)
        {
            db.TemplateExercises.RemoveRange(rows[day.Id]);
            db.Templates.Remove(day);
        }
        // Finished sessions keep their own snapshots; they only lose the link to a day that is gone.
        foreach (var session in await db.Workouts.Where(workout => workout.TemplateId != null
            && removedIds.Contains(workout.TemplateId.Value)).ToListAsync(ct))
        {
            session.TemplateId = null;
            session.Revision++;
        }
        program.Name = input.Name.Trim();
        program.Weeks = final.Max(day => day.Week);
        program.Revision++;
        await new ProgramPhaseSync(db).Sync(program, final, ct);
        await templates.Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);

        if (locks.RunInProgress) await ReconcileRun(program, final, removedIds, ct);
        await gate.Commit(ct);
        return await programs.Get(id, ct);
    }

    // An imported program may leave a working set's effort unstated, exactly as when it was created.
    private async Task ValidateChangedDays(List<PlannedDay> plan, bool requireWorkingRpe, CancellationToken ct)
    {
        foreach (var planned in plan.Where(planned => !planned.Locked && (planned.Stored is null || planned.ContentChanged)))
        {
            var day = planned.Input;
            await templates.ValidateInput(new TemplateInput(day.Name, day.Focus, day.Note, day.Exercises, null, null,
                day.Block, day.Phase, day.PhaseWeek, day.IsRestDay), ct, requireWorkingRpe);
            Validation.Require(day.SourcePage is null || day.SourcePage.Value is > 0 and <= ImportSourceText.MaxPages,
                "Workout source page is invalid.");
            // Same rule as building a program: every training exercise comes from the library.
            Validation.Require(day.IsRestDay || day.Exercises.All(exercise => exercise.ExerciseId is not null),
                "Choose an exercise from the library for every training-day exercise before saving the program.", 422);
        }
    }

    private WorkoutTemplate CreateDay(TrainingProgram program, ProgramEditDayInput input, int position)
    {
        var day = new WorkoutTemplate { UserId = program.UserId, ProgramId = program.Id };
        Describe(day, input, position);
        db.Templates.Add(day);
        templates.AddExercises(day.Id, input.Exercises);
        day.BaselineJson = TemplateService.CreateTemplateBaseline(day, db.TemplateExercises.Local.Where(row => row.TemplateId == day.Id));
        return day;
    }

    /// A past day is never rewritten; only its place among its week's days may shift when a new
    /// day is added before it.
    private static WorkoutTemplate KeepPastDay(WorkoutTemplate day, int position)
    {
        day.Position = position;
        return day;
    }

    private WorkoutTemplate RewriteDay(PlannedDay planned, List<TemplateExercise> rows, int position, out bool placementChanged)
    {
        var day = planned.Stored!;
        var input = planned.Input;
        placementChanged = day.Week != input.Week || day.Position != position
            || day.PhaseWeek != input.PhaseWeek || day.SourcePage != input.SourcePage
            || ProgramDayComparer.BlockLabel(day.Block) != ProgramDayComparer.BlockLabel(input.Block)
            || (day.Phase?.Trim() ?? "") != (input.Phase?.Trim() ?? "");
        Describe(day, input, position);
        if (planned.ContentChanged)
        {
            TemplateService.EnsureBaseline(day, rows);
            templates.SyncExercises(day.Id, rows, input.Exercises);
        }
        if (planned.ContentChanged || placementChanged) day.Revision++;
        return day;
    }

    private static void Describe(WorkoutTemplate day, ProgramEditDayInput input, int position)
    {
        day.Name = input.Name.Trim();
        day.Focus = input.Focus?.Trim() ?? "";
        day.Note = input.Note?.Trim() ?? "";
        day.Week = input.Week;
        day.Position = position;
        day.Block = ProgramDayComparer.BlockLabel(input.Block);
        day.Phase = input.Phase?.Trim() ?? "";
        day.PhaseWeek = input.PhaseWeek;
        day.IsRestDay = input.IsRestDay;
        day.SourcePage = input.SourcePage;
    }

    /// Brings the run's day rows in line with the edited shape: rows for removed or moved days go,
    /// the current week gains rows for days placed in it, and a week whose remaining days are all
    /// passed moves on exactly as if the last of them had just been done.
    private async Task ReconcileRun(TrainingProgram program, List<WorkoutTemplate> final, HashSet<Guid> removed, CancellationToken ct)
    {
        var run = await progress.LatestRun(program.Id, ct);
        if (run is null) return;
        var weekOf = final.ToDictionary(day => day.Id, day => day.Week);
        var rows = await db.ProgramDayProgresses.Where(row => row.RunId == run.Id).ToListAsync(ct);
        var stale = rows.Where(row => removed.Contains(row.TemplateId)
            || (weekOf.TryGetValue(row.TemplateId, out var week) && week != row.Week)).ToList();
        if (stale.Count > 0)
        {
            var staleIds = stale.Select(row => row.Id).ToList();
            foreach (var session in await db.Workouts.Where(workout => workout.ProgramDayProgressId != null
                && staleIds.Contains(workout.ProgramDayProgressId.Value)).ToListAsync(ct))
            {
                session.ProgramDayProgressId = null;
                session.Revision++;
            }
            db.ProgramDayProgresses.RemoveRange(stale);
        }
        var skipped = await db.ProgramSkips.Where(skip => skip.ProgramId == program.Id && removed.Contains(skip.TemplateId)).ToListAsync(ct);
        db.ProgramSkips.RemoveRange(skipped);
        run.Revision++;
        await db.SaveChangesAsync(ct);

        await progress.AdvanceIfWeekPassed(program, run, final, ct);
        await db.SaveChangesAsync(ct);
    }
}
