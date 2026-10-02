using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// A standalone workout can hold the account's single active slot as a one-day run. Programs
/// enter and leave the slot through ProgramLifecycleService; both share VacateSlot so only one
/// holder exists and the outgoing holder's progress is forgotten.
public sealed class ActiveSlotService(AppDb db, TemplateService templates, ProgramLifecycleService lifecycle)
{
    public async Task<TemplateView> SetTemplateActive(Guid id, bool active, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var template = await RequireStandalone(id, ct);
        if (template.Active != active)
        {
            TemplateService.RequireFresh(revision, template.Revision);
            if (active)
            {
                await lifecycle.VacateSlot(ct);
                template.Active = true;
            }
            else
            {
                await RequireNoWorkoutFrom(template, ct);
                template.Active = false;
            }
            template.ActiveCompletedAt = null;
            template.Revision++;
            await db.SaveChangesAsync(ct);
        }
        await gate.Commit(ct);
        return await templates.Get(id, ct);
    }

    public async Task<TemplateView> RestartTemplate(Guid id, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var template = await RequireStandalone(id, ct);
        Validation.Require(template.Active, "Activate this workout before restarting it.", 409);
        TemplateService.RequireFresh(revision, template.Revision);
        Validation.Require(revision == template.Revision, "Refresh the workout before restarting it.", 409);
        await RequireNoWorkoutFrom(template, ct);
        template.ActiveCompletedAt = null;
        template.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await templates.Get(id, ct);
    }

    private async Task<WorkoutTemplate> RequireStandalone(Guid id, CancellationToken ct)
    {
        var template = await db.Templates.SingleOrDefaultAsync(candidate => candidate.Id == id, ct);
        Validation.Require(template is not null, "That workout no longer exists.", 404);
        Validation.Require(template!.ProgramId is null, "Program days are activated with their program.", 409);
        return template;
    }

    private async Task RequireNoWorkoutFrom(WorkoutTemplate template, CancellationToken ct)
        => Validation.Require(!await db.Workouts.AnyAsync(workout => workout.Active && workout.TemplateId == template.Id, ct),
            "Finish or discard the active workout from this plan first.", 409);
}
