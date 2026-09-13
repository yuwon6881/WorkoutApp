using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record ProgramWorkoutInput(int Week, string Name, string? Focus, string? Note, List<TemplateExerciseInput> Exercises);
public record ProgramInput(string Name, string? Description, List<ProgramWorkoutInput> Workouts, Guid? IdempotencyId);
public record ProgramView(Guid Id, string Name, string Description, int Weeks, bool Active, int Revision, Guid? SourceImportId, List<TemplateView> Workouts, List<Guid> CompletedTemplateIds, Guid? NextTemplateId);

public sealed class ProgramService(AppDb db, TemplateService templates)
{
    public async Task<List<ProgramView>> List(CancellationToken ct)
    {
        var programs = await db.Programs.AsNoTracking().OrderByDescending(p => p.Active).ThenByDescending(p => p.Created).ToListAsync(ct);
        var views = new List<ProgramView>();
        foreach (var program in programs) views.Add(await View(program, ct));
        return views;
    }

    public async Task<ProgramView> Get(Guid id, CancellationToken ct)
    {
        var program = await db.Programs.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        Validation.Require(program != null, "That program no longer exists.", 404);
        return await View(program!, ct);
    }

    public async Task<ProgramView> View(TrainingProgram program, CancellationToken ct)
    {
        var rows = await db.Templates.AsNoTracking().Where(t => t.ProgramId == program.Id).OrderBy(t => t.Week).ThenBy(t => t.Position).ToListAsync(ct);
        var workouts = await templates.Views(rows, ct);
        // A program slot counts as done once a session started from it has been finished.
        var completed = await db.Workouts.AsNoTracking()
            .Where(w => w.ProgramId == program.Id && w.FinishedAt != null && w.TemplateId != null)
            .Select(w => w.TemplateId!.Value).Distinct().ToListAsync(ct);
        var next = workouts.FirstOrDefault(w => !completed.Contains(w.Id))?.Id;
        return new ProgramView(program.Id, program.Name, program.Description, program.Weeks, program.Active, program.Revision, program.SourceImportId, workouts, completed, next);
    }

    public async Task<ProgramView> Create(ProgramInput input, bool activate, Guid? sourceImportId, CancellationToken ct)
    {
        await Validate(input, ct);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await Materialize(input, activate, sourceImportId, ct);
        await templates.Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(program.Id, ct);
    }

    /// Builds the program and all of its workouts in one unit of work. The caller owns the
    /// transaction so an AI acceptance either lands whole or not at all.
    public async Task<TrainingProgram> Materialize(ProgramInput input, bool activate, Guid? sourceImportId, CancellationToken ct)
    {
        // A new program only becomes active when nothing else holds that slot.
        var active = activate && !await db.Programs.AnyAsync(p => p.Active, ct);
        var program = new TrainingProgram
        {
            UserId = db.CurrentUser!.Value, Name = input.Name.Trim(), Description = input.Description?.Trim() ?? "",
            Weeks = input.Workouts.Max(w => w.Week), Active = active, SourceImportId = sourceImportId
        };
        db.Programs.Add(program);
        var position = new Dictionary<int, int>();
        foreach (var workout in input.Workouts)
        {
            position.TryGetValue(workout.Week, out var index);
            position[workout.Week] = index + 1;
            var template = new WorkoutTemplate
            {
                UserId = program.UserId, ProgramId = program.Id, Name = workout.Name.Trim(), Focus = workout.Focus?.Trim() ?? "",
                Note = workout.Note?.Trim() ?? "", Week = workout.Week, Position = index
            };
            db.Templates.Add(template);
            templates.AddExercises(template.Id, workout.Exercises);
        }
        return program;
    }

    public async Task<ProgramView> SetActive(Guid id, bool active, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await db.Programs.SingleOrDefaultAsync(p => p.Id == id, ct);
        Validation.Require(program != null, "That program no longer exists.", 404);
        TemplateService.RequireFresh(revision, program!.Revision);
        if (active)
        {
            // The one-active-program index is checked per statement, so the outgoing program has
            // to be written out before the incoming one claims the slot. Both writes share this
            // transaction, so the swap is still atomic.
            var current = await db.Programs.Where(p => p.Active && p.Id != id).ToListAsync(ct);
            foreach (var other in current) { other.Active = false; other.Revision++; }
            if (current.Count > 0) await db.SaveChangesAsync(ct);
        }
        program.Active = active; program.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    public async Task Delete(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await db.Programs.SingleOrDefaultAsync(p => p.Id == id, ct);
        Validation.Require(program != null, "That program no longer exists.", 404);
        var ids = await db.Templates.Where(t => t.ProgramId == id).Select(t => t.Id).ToListAsync(ct);
        Validation.Require(!await db.Workouts.AnyAsync(w => w.Active && w.ProgramId == id, ct), "Finish or discard the active workout before deleting its program.", 409);
        db.TemplateExercises.RemoveRange(await db.TemplateExercises.Where(e => ids.Contains(e.TemplateId)).ToListAsync(ct));
        db.Templates.RemoveRange(await db.Templates.Where(t => t.ProgramId == id).ToListAsync(ct));
        // Finished sessions keep their own snapshots, so history survives the program going away.
        foreach (var session in await db.Workouts.Where(w => w.ProgramId == id).ToListAsync(ct)) { session.ProgramId = null; session.TemplateId = null; session.Revision++; }
        db.Programs.Remove(program!);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public async Task Validate(ProgramInput input, CancellationToken ct)
    {
        Validation.Name(input.Name, "Program name");
        Validation.Text(input.Description, 4000, "Program description");
        Validation.Require(input.Workouts is { Count: > 0 }, "A program needs at least one workout.");
        Validation.Require(input.Workouts.Count <= 200, "A program can have at most 200 workouts.");
        Validation.Require(input.Workouts.All(w => w.Week is > 0 and <= 104), "Program weeks must be between 1 and 104.");
        foreach (var workout in input.Workouts)
            await templates.ValidateInput(new TemplateInput(workout.Name, workout.Focus, workout.Note, workout.Exercises, null, null), ct);
    }
}
