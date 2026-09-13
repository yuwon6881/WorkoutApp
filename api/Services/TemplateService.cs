using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record TemplateExerciseInput(Guid? ExerciseId, string SourceName, string? Note, List<SetPrescription> Sets);
public record TemplateInput(string Name, string? Focus, string? Note, List<TemplateExerciseInput> Exercises, int? Revision, Guid? IdempotencyId);
public record TemplateExerciseView(Guid Id, Guid? ExerciseId, string SourceName, string Name, string Note, int Position, List<SetPrescription> Sets);
public record TemplateView(Guid Id, Guid? ProgramId, string Name, string Focus, string Note, int Week, int Position, int Revision, List<TemplateExerciseView> Exercises);

public sealed class TemplateService(AppDb db, CatalogService catalog)
{
    public async Task<List<TemplateView>> List(Guid? programId, bool standaloneOnly, CancellationToken ct)
    {
        var query = db.Templates.AsNoTracking().AsQueryable();
        if (standaloneOnly) query = query.Where(t => t.ProgramId == null);
        else if (programId != null) query = query.Where(t => t.ProgramId == programId);
        var templates = await query.OrderBy(t => t.Week).ThenBy(t => t.Position).ThenBy(t => t.Created).ToListAsync(ct);
        return await Views(templates, ct);
    }

    public async Task<TemplateView> Get(Guid id, CancellationToken ct)
    {
        var template = await db.Templates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, ct);
        Validation.Require(template != null, "That workout no longer exists.", 404);
        return (await Views([template!], ct)).Single();
    }

    public async Task<List<TemplateView>> Views(List<WorkoutTemplate> templates, CancellationToken ct)
    {
        var ids = templates.Select(t => t.Id).ToList();
        var rows = await db.TemplateExercises.AsNoTracking().Where(e => ids.Contains(e.TemplateId)).OrderBy(e => e.Position).ToListAsync(ct);
        var names = await CatalogNames(rows.Select(r => r.ExerciseId), ct);
        return templates.Select(t => new TemplateView(t.Id, t.ProgramId, t.Name, t.Focus, t.Note, t.Week, t.Position, t.Revision,
            rows.Where(e => e.TemplateId == t.Id).Select(e => new TemplateExerciseView(e.Id, e.ExerciseId, e.SourceName,
                e.ExerciseId is { } id && names.TryGetValue(id, out var name) ? name : e.SourceName,
                e.Note, e.Position, Json.Read<List<SetPrescription>>(e.SetsJson))).ToList())).ToList();
    }

    public async Task<Dictionary<Guid, string>> CatalogNames(IEnumerable<Guid?> ids, CancellationToken ct)
    {
        var wanted = ids.Where(i => i != null).Select(i => i!.Value).Distinct().ToList();
        if (wanted.Count == 0) return [];
        return await db.Exercises.AsNoTracking().Where(x => wanted.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
    }

    public async Task<TemplateView> Create(TemplateInput input, Guid? programId, int week, int position, CancellationToken ct)
    {
        await ValidateInput(input, ct);
        var template = new WorkoutTemplate
        {
            UserId = db.CurrentUser!.Value, ProgramId = programId, Name = input.Name.Trim(),
            Focus = input.Focus?.Trim() ?? "", Note = input.Note?.Trim() ?? "", Week = week, Position = position
        };
        db.Templates.Add(template);
        AddExercises(template.Id, input.Exercises);
        await Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);
        return await Get(template.Id, ct);
    }

    public async Task<TemplateView> Update(Guid id, TemplateInput input, CancellationToken ct)
    {
        await ValidateInput(input, ct);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var template = await db.Templates.SingleOrDefaultAsync(t => t.Id == id, ct);
        Validation.Require(template != null, "That workout no longer exists.", 404);
        RequireFresh(input.Revision, template!.Revision);
        template.Name = input.Name.Trim(); template.Focus = input.Focus?.Trim() ?? ""; template.Note = input.Note?.Trim() ?? "";
        template.Revision++;
        db.TemplateExercises.RemoveRange(await db.TemplateExercises.Where(e => e.TemplateId == id).ToListAsync(ct));
        AddExercises(id, input.Exercises);
        await Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    public async Task Delete(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var template = await db.Templates.SingleOrDefaultAsync(t => t.Id == id, ct);
        Validation.Require(template != null, "That workout no longer exists.", 404);
        Validation.Require(!await db.Workouts.AnyAsync(w => w.TemplateId == id && w.Active, ct), "Finish or discard the active workout before deleting its plan.", 409);
        db.TemplateExercises.RemoveRange(await db.TemplateExercises.Where(e => e.TemplateId == id).ToListAsync(ct));
        db.Templates.Remove(template!);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public void AddExercises(Guid templateId, List<TemplateExerciseInput> exercises)
    {
        var position = 0;
        foreach (var exercise in exercises)
            db.TemplateExercises.Add(new TemplateExercise
            {
                UserId = db.CurrentUser!.Value, TemplateId = templateId, ExerciseId = exercise.ExerciseId,
                SourceName = exercise.SourceName.Trim(), Note = exercise.Note?.Trim() ?? "", Position = position++,
                SetsJson = Json.Write(exercise.Sets)
            });
    }

    public async Task ValidateInput(TemplateInput input, CancellationToken ct)
    {
        Validation.Name(input.Name, "Workout name");
        Validation.Text(input.Focus, 120, "Focus"); Validation.Text(input.Note, 2000, "Workout notes");
        Validation.Require(input.Exercises is { Count: > 0 }, "Add at least one exercise to this workout.");
        Validation.Require(input.Exercises.Count <= 40, "A workout can have at most 40 exercises.");
        foreach (var exercise in input.Exercises)
        {
            Validation.Name(exercise.SourceName, "Exercise name", 160);
            Validation.Text(exercise.Note, 1000, "Exercise notes");
            Validation.Prescriptions(exercise.Sets);
            await catalog.RequireActive(exercise.ExerciseId, ct);
        }
    }

    public static void RequireFresh(int? supplied, int actual)
        => Validation.Require(supplied == null || supplied == actual, "This changed on another device. Refresh to see the newer version before saving.", 409);

    /// A replayed request carrying a spent idempotency id fails the primary key, which the
    /// pipeline reports as a conflict rather than writing the same change twice.
    public async Task Receipt(Guid? id, CancellationToken ct)
    {
        if (id == null) return;
        Validation.Require(!await db.Receipts.AnyAsync(r => r.Id == id, ct), "This change was already saved.", 409);
        db.Receipts.Add(new MutationReceipt { UserId = db.CurrentUser!.Value, Id = id.Value });
    }
}
