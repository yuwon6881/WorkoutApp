using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Owns run activation and monotonic day transitions. ProgramService keeps the catalog and view
/// projections separate from this state machine.
public sealed class ProgramLifecycleService(AppDb db, TemplateService templates, ProgramProgressService progress)
{
    public async Task EnsureActiveRun(Guid programId, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await db.Programs.SingleOrDefaultAsync(candidate => candidate.Id == programId, ct);
        if (program?.Active == true)
        {
            var rows = await db.Templates.Where(template => template.ProgramId == programId)
                .OrderBy(template => template.Week).ThenBy(template => template.Position).ToListAsync(ct);
            var run = await progress.LatestRun(programId, ct);
            if (run is null)
            {
                run = await progress.EnsureLegacyRun(program, rows, ct);
                await db.SaveChangesAsync(ct);
            }
            await progress.AdvanceIfWeekPassed(program, run, rows, ct);
            await db.SaveChangesAsync(ct);
        }
        await gate.Commit(ct);
    }

    public async Task SetActive(Guid id, bool active, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await db.Programs.SingleOrDefaultAsync(candidate => candidate.Id == id, ct);
        Validation.Require(program is not null, "That program no longer exists.", 404);
        if (program!.Active == active && ((active && program.LifecycleStatus == ProgramLifecycle.Active) ||
            (!active && program.LifecycleStatus is ProgramLifecycle.Standby or ProgramLifecycle.Completed)))
        {
            if (active)
            {
                var rows = await db.Templates.Where(template => template.ProgramId == id).OrderBy(template => template.Week).ThenBy(template => template.Position).ToListAsync(ct);
                var run = await progress.LatestRun(id, ct);
                if (run is null)
                {
                    run = await progress.EnsureLegacyRun(program, rows, ct);
                    await db.SaveChangesAsync(ct);
                }
                await progress.AdvanceIfWeekPassed(program, run, rows, ct);
                await db.SaveChangesAsync(ct);
            }
            await gate.Commit(ct);
            return;
        }
        TemplateService.RequireFresh(revision, program.Revision);
        if (active)
        {
            // The one-active-program index is checked per statement, so the outgoing program has
            // to be written out before the incoming one claims the slot. Both writes share this
            // transaction, so the swap is still atomic.
            var current = await db.Programs.Where(candidate => candidate.Active && candidate.Id != id).ToListAsync(ct);
            foreach (var other in current)
            {
                other.Active = false;
                other.LifecycleStatus = other.CompletedAt is null ? ProgramLifecycle.Standby : ProgramLifecycle.Completed;
                other.Revision++;
            }
            if (current.Count > 0) await db.SaveChangesAsync(ct);
            var programTemplates = await db.Templates.Where(template => template.ProgramId == id)
                .OrderBy(template => template.Week).ThenBy(template => template.Position).ToListAsync(ct);
            var latestRun = await progress.LatestRun(id, ct);
            if (latestRun is null && program.LifecycleStatus != ProgramLifecycle.Completed && program.CompletedAt is null)
                await progress.EnsureLegacyRun(program, programTemplates, ct);
            else if (latestRun is null || latestRun.CompletedAt is not null)
                progress.CreateRun(program, programTemplates, (latestRun?.Number ?? 0) + 1);
        }
        program.Active = active;
        program.LifecycleStatus = active ? ProgramLifecycle.Active : ProgramLifecycle.Standby;
        program.CompletedAt = null;
        program.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public async Task Reconcile(Guid programId, CancellationToken ct)
    {
        var program = await db.Programs.SingleOrDefaultAsync(candidate => candidate.Id == programId, ct);
        if (program is null) return;
        var allTemplates = await db.Templates.Where(template => template.ProgramId == programId).ToListAsync(ct);
        var run = await progress.LatestRun(programId, ct) ?? await progress.EnsureLegacyRun(program, allTemplates, ct);
        await progress.AdvanceIfWeekPassed(program, run, allTemplates, ct);
    }

    public async Task Skip(Guid id, Guid templateId, ProgramDayActionInput input, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await db.Programs.SingleOrDefaultAsync(candidate => candidate.Id == id, ct);
        Validation.Require(program is not null, "That program no longer exists.", 404);
        var template = await db.Templates.SingleOrDefaultAsync(candidate => candidate.Id == templateId && candidate.ProgramId == id, ct);
        Validation.Require(template is not null && !template!.IsRestDay, "That workout slot cannot be skipped.", 409);
        Validation.Require(program!.Active, "Activate this program before skipping its workouts.", 409);
        Validation.Require(!await db.Workouts.AnyAsync(workout => workout.Active, ct), "Finish or discard the active workout first.", 409);
        var run = await RequireCurrentRun(program, input, ct);
        var allTemplates = await db.Templates.Where(candidate => candidate.ProgramId == id).ToListAsync(ct);
        var currentDays = await progress.EnsureCurrentWeek(program, run, allTemplates, ct);
        var day = currentDays.SingleOrDefault(candidate => candidate.TemplateId == templateId && candidate.Week == run.CurrentWeek && candidate.Attempt == run.CurrentAttempt);
        Validation.Require(day is not null, "That workout is outside the current program week.", 409);
        if (day!.Status == ProgramDayStatus.Skipped)
        {
            await gate.Commit(ct);
            return;
        }
        Validation.Require(day.Status == ProgramDayStatus.Pending, "A passed workout cannot be changed. Reset the week to start it again.", 409);
        ProgramProgressService.Pass(day, ProgramDayStatus.Skipped);
        var legacySkip = await db.ProgramSkips.SingleOrDefaultAsync(skip => skip.ProgramId == id && skip.TemplateId == templateId, ct);
        if (legacySkip is null) db.ProgramSkips.Add(new ProgramSkip { UserId = program.UserId, ProgramId = id, TemplateId = templateId });
        program.Revision++;
        run.Revision++;
        await templates.Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);
        await Reconcile(id, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public async Task SkipLegacy(Guid id, Guid templateId, CancellationToken ct)
    {
        await EnsureActiveRun(id, ct);
        var program = await db.Programs.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.Id == id, ct);
        Validation.Require(program is not null, "That program no longer exists.", 404);
        var run = await progress.LatestRun(id, ct);
        Validation.Require(run is not null, "Activate this program before skipping its workouts.", 409);
        await Skip(id, templateId, new ProgramDayActionInput(program!.Revision, run!.Id, run.CurrentWeek, run.CurrentAttempt, Guid.NewGuid()), ct);
    }

    public async Task AcknowledgeRest(Guid id, Guid templateId, ProgramDayActionInput input, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await db.Programs.SingleOrDefaultAsync(candidate => candidate.Id == id, ct);
        Validation.Require(program?.Active == true, "Activate this program before passing a rest day.", 409);
        Validation.Require(!await db.Workouts.AnyAsync(workout => workout.Active, ct), "Finish or discard the active workout first.", 409);
        var template = await db.Templates.SingleOrDefaultAsync(candidate => candidate.Id == templateId && candidate.ProgramId == id, ct);
        Validation.Require(template?.IsRestDay == true, "Only a rest day can be ticked here.", 409);
        var run = await RequireCurrentRun(program!, input, ct);
        var allTemplates = await db.Templates.Where(candidate => candidate.ProgramId == id).ToListAsync(ct);
        var currentDays = await progress.EnsureCurrentWeek(program!, run, allTemplates, ct);
        var day = currentDays.SingleOrDefault(candidate => candidate.TemplateId == templateId && candidate.Week == run.CurrentWeek && candidate.Attempt == run.CurrentAttempt);
        Validation.Require(day is not null, "That rest day is outside the current program week.", 409);
        if (day!.Status == ProgramDayStatus.RestPassed)
        {
            await gate.Commit(ct);
            return;
        }
        Validation.Require(day.Status == ProgramDayStatus.Pending, "This day has already been passed.", 409);
        ProgramProgressService.Pass(day, ProgramDayStatus.RestPassed);
        program!.Revision++;
        run.Revision++;
        await templates.Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);
        await Reconcile(id, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public async Task ResetWeek(Guid id, ProgramWeekResetInput input, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await db.Programs.SingleOrDefaultAsync(candidate => candidate.Id == id, ct);
        Validation.Require(program?.Active == true, "Activate this program before resetting a week.", 409);
        Validation.Require(input.Confirmation == "RESET", "Type RESET to confirm clearing this week.", 422);
        TemplateService.RequireFresh(input.Revision, program!.Revision);
        Validation.Require(input.Revision == program.Revision, "Refresh the program before resetting this week.", 409);
        Validation.Require(!await db.Workouts.AnyAsync(workout => workout.Active, ct),
            "Finish or discard the active workout before resetting this week.", 409);
        var run = await RequireCurrentRun(program, input, ct);
        var allTemplates = await db.Templates.Where(template => template.ProgramId == id).ToListAsync(ct);
        var currentTemplates = allTemplates.Where(template => template.Week == run.CurrentWeek).ToList();
        var oldProgress = await progress.EnsureCurrentWeek(program, run, allTemplates, ct);
        Validation.Require(oldProgress.Any(day => ProgramDayStatus.IsPassed(day.Status)), "This week has no passed days to reset.", 409);
        db.ProgramSkips.RemoveRange(await db.ProgramSkips.Where(skip => skip.ProgramId == id &&
            currentTemplates.Select(template => template.Id).Contains(skip.TemplateId)).ToListAsync(ct));
        run.CurrentAttempt++;
        run.Revision++;
        foreach (var template in currentTemplates)
            db.ProgramDayProgresses.Add(new ProgramDayProgress
            {
                UserId = program.UserId,
                ProgramId = id,
                RunId = run.Id,
                TemplateId = template.Id,
                Week = run.CurrentWeek,
                Attempt = run.CurrentAttempt
            });
        program.Revision++;
        await templates.Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public Task Unskip(Guid id, Guid templateId, CancellationToken ct)
        => throw new DomainException("A passed day cannot be unticked. Reset the current week to clear its checkmarks.", 409);

    public async Task<ProgramDayProgress> PendingWorkoutDay(Guid programId, Guid templateId, CancellationToken ct)
    {
        var program = await db.Programs.SingleOrDefaultAsync(candidate => candidate.Id == programId, ct);
        Validation.Require(program?.Active == true, "Activate this program before starting its workouts.", 409);
        var allTemplates = await db.Templates.Where(template => template.ProgramId == programId)
            .OrderBy(template => template.Week).ThenBy(template => template.Position).ToListAsync(ct);
        var run = await progress.LatestRun(programId, ct) ?? await progress.EnsureLegacyRun(program!, allTemplates, ct);
        await progress.AdvanceIfWeekPassed(program!, run, allTemplates, ct);
        Validation.Require(program!.Active && run.CompletedAt is null, "This program run has finished. Activate it to start a fresh run.", 409);
        var template = allTemplates.SingleOrDefault(candidate => candidate.Id == templateId && candidate.Week == run.CurrentWeek && !candidate.IsRestDay);
        Validation.Require(template is not null, "Choose a workout from the current program week.", 409);
        var days = await progress.EnsureCurrentWeek(program, run, allTemplates, ct);
        var day = days.SingleOrDefault(candidate => candidate.TemplateId == templateId);
        Validation.Require(day?.Status == ProgramDayStatus.Pending, "That workout day has already been passed.", 409);
        return day!;
    }

    public async Task CompleteWorkout(WorkoutSession session, CancellationToken ct)
    {
        if (session.ProgramId is not { } programId || session.ProgramDayProgressId is not { } dayId || session.TemplateId is not { } templateId) return;
        var day = await db.ProgramDayProgresses.SingleOrDefaultAsync(candidate => candidate.Id == dayId &&
            candidate.ProgramId == programId && candidate.TemplateId == templateId, ct);
        if (day is null || day.Status != ProgramDayStatus.Pending) return;
        var run = await db.ProgramRuns.SingleOrDefaultAsync(candidate => candidate.Id == day.RunId && candidate.CompletedAt == null, ct);
        var program = await db.Programs.SingleOrDefaultAsync(candidate => candidate.Id == programId, ct);
        if (run is null || program is null || (run.CurrentWeek == day.Week && run.CurrentAttempt != day.Attempt)) return;
        ProgramProgressService.Pass(day, ProgramDayStatus.Completed);
        run.Revision++;
        program.Revision++;
        var allTemplates = await db.Templates.Where(template => template.ProgramId == programId).ToListAsync(ct);
        await progress.AdvanceIfWeekPassed(program, run, allTemplates, ct);
    }

    private async Task<ProgramRun> RequireCurrentRun(TrainingProgram program, ProgramDayActionInput input, CancellationToken ct)
    {
        Validation.Require(input.Revision == program.Revision, "This program changed on another device. Refresh and try again.", 409);
        var run = await progress.LatestRun(program.Id, ct);
        Validation.Require(run is not null && run.CompletedAt is null && input.RunId == run.Id &&
            input.Week == run.CurrentWeek && input.Attempt == run.CurrentAttempt,
            "This week changed on another device. Refresh to see the current week.", 409);
        return run!;
    }

    private async Task<ProgramRun> RequireCurrentRun(TrainingProgram program, ProgramWeekResetInput input, CancellationToken ct)
    {
        Validation.Require(input.Revision == program.Revision, "This program changed on another device. Refresh and try again.", 409);
        var run = await progress.LatestRun(program.Id, ct);
        Validation.Require(run is not null && run.CompletedAt is null && input.RunId == run.Id &&
            input.Week == run.CurrentWeek && input.Attempt == run.CurrentAttempt,
            "This week changed on another device. Refresh to see the current week.", 409);
        return run!;
    }
}
