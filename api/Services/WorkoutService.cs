using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record SetInput(double? WeightKg, int? Reps, double? Rpe, bool Done);
public record SessionExerciseInput(Guid? ExerciseId, string NameSnapshot, string? Note, List<SetPrescription> Prescription, List<SetInput> Sets);
public record SessionInput(string? Note, List<SessionExerciseInput> Exercises, int? Revision, Guid? IdempotencyId);
public record SetView(Guid Id, int Position, double? WeightKg, int? Reps, double? Rpe, bool Done);
public record SessionExerciseView(Guid Id, Guid? ExerciseId, string Name, int Position, string Note, List<SetPrescription> Prescription, List<SetView> Sets);
public record SessionView(Guid Id, Guid? TemplateId, Guid? ProgramId, string Name, string Note, bool Active, DateTime StartedAt, DateTime? FinishedAt, int Revision, List<SessionExerciseView> Exercises, double? VolumeKg, int CompletedSets);

public sealed class WorkoutService(AppDb db, CatalogService catalog, TemplateService templates)
{
    public async Task<SessionView?> Active(CancellationToken ct)
    {
        var session = await db.Workouts.AsNoTracking().SingleOrDefaultAsync(w => w.Active, ct);
        return session == null ? null : await View(session, ct);
    }

    public async Task<SessionView> Get(Guid id, CancellationToken ct)
    {
        var session = await db.Workouts.AsNoTracking().SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        return await View(session!, ct);
    }

    public async Task<SessionView> View(WorkoutSession session, CancellationToken ct)
    {
        var exercises = await db.SessionExercises.AsNoTracking().Where(e => e.SessionId == session.Id).OrderBy(e => e.Position).ToListAsync(ct);
        var ids = exercises.Select(e => e.Id).ToList();
        var sets = await db.Sets.AsNoTracking().Where(s => ids.Contains(s.SessionExerciseId)).OrderBy(s => s.Position).ToListAsync(ct);
        var done = sets.Where(s => s.Done).ToList();
        // Volume counts only sets whose load is actually known; an unknown weight is not zero.
        var known = done.Where(s => s.WeightKg != null).ToList();
        return new SessionView(session.Id, session.TemplateId, session.ProgramId, session.Name, session.Note, session.Active,
            session.StartedAt, session.FinishedAt, session.Revision,
            exercises.Select(e => new SessionExerciseView(e.Id, e.ExerciseId, e.NameSnapshot, e.Position, e.Note,
                Json.Read<List<SetPrescription>>(e.PrescriptionJson),
                sets.Where(s => s.SessionExerciseId == e.Id).Select(s => new SetView(s.Id, s.Position, s.WeightKg, s.Reps, s.Rpe, s.Done)).ToList())).ToList(),
            known.Count == 0 ? null : known.Sum(s => s.WeightKg!.Value * s.Reps!.Value), done.Count);
    }

    /// Starts a workout from a plan, prefilling each set with the last load and reps recorded
    /// for that exercise. Prefilled sets are suggestions: none of them are marked complete.
    public async Task<SessionView> Start(Guid? templateId, string? name, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        Validation.Require(!await db.Workouts.AnyAsync(w => w.Active, ct), "Finish or discard your current workout before starting another.", 409);
        WorkoutTemplate? template = null;
        if (templateId is { } id)
        {
            template = await db.Templates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, ct);
            Validation.Require(template != null, "That workout plan no longer exists.", 404);
        }
        else Validation.Name(name, "Workout name");

        var session = new WorkoutSession
        {
            UserId = db.CurrentUser!.Value, TemplateId = template?.Id, ProgramId = template?.ProgramId,
            Name = template?.Name ?? name!.Trim(), Active = true
        };
        db.Workouts.Add(session);

        if (template != null)
        {
            var planned = await db.TemplateExercises.AsNoTracking().Where(e => e.TemplateId == template.Id).OrderBy(e => e.Position).ToListAsync(ct);
            var names = await templates.CatalogNames(planned.Select(p => p.ExerciseId), ct);
            foreach (var plan in planned)
            {
                var prescription = Json.Read<List<SetPrescription>>(plan.SetsJson);
                var exercise = new SessionExercise
                {
                    UserId = session.UserId, SessionId = session.Id, ExerciseId = plan.ExerciseId, Position = plan.Position,
                    NameSnapshot = plan.ExerciseId is { } catalogId && names.TryGetValue(catalogId, out var resolved) ? resolved : plan.SourceName,
                    Note = plan.Note, PrescriptionJson = plan.SetsJson
                };
                db.SessionExercises.Add(exercise);
                var previous = await Previous(plan.ExerciseId, plan.SourceName, ct);
                for (var index = 0; index < prescription.Count; index++)
                {
                    var last = previous.ElementAtOrDefault(index);
                    db.Sets.Add(new CompletedSet
                    {
                        UserId = session.UserId, SessionExerciseId = exercise.Id, Position = index,
                        WeightKg = last?.WeightKg, Reps = last?.Reps ?? prescription[index].RepMin, Rpe = null, Done = false
                    });
                }
            }
        }
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(session.Id, ct);
    }

    /// The most recent completed sets for an exercise, matched by catalog id where one exists
    /// and by snapshotted name otherwise, so unresolved exercises still carry their history.
    public async Task<List<CompletedSet>> Previous(Guid? exerciseId, string name, CancellationToken ct)
    {
        var query = db.SessionExercises.AsNoTracking().Join(db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null),
            e => e.SessionId, w => w.Id, (e, w) => new { Exercise = e, w.FinishedAt });
        query = exerciseId is { } id
            ? query.Where(x => x.Exercise.ExerciseId == id)
            : query.Where(x => x.Exercise.ExerciseId == null && x.Exercise.NameSnapshot == name);
        var latest = await query.OrderByDescending(x => x.FinishedAt).Select(x => x.Exercise.Id).FirstOrDefaultAsync(ct);
        if (latest == Guid.Empty) return [];
        return await db.Sets.AsNoTracking().Where(s => s.SessionExerciseId == latest && s.Done).OrderBy(s => s.Position).ToListAsync(ct);
    }

    public async Task<SessionView> Save(Guid id, SessionInput input, CancellationToken ct)
    {
        Validation.Text(input.Note, 4000, "Workout notes");
        Validation.Require(input.Exercises is { Count: <= 40 }, "A workout can have at most 40 exercises.");
        foreach (var exercise in input.Exercises)
        {
            Validation.Name(exercise.NameSnapshot, "Exercise name", 160);
            Validation.Text(exercise.Note, 1000, "Exercise notes");
            Validation.Prescriptions(exercise.Prescription);
            Validation.Require(exercise.Sets is { Count: <= 20 }, "An exercise can have at most 20 sets.");
            foreach (var set in exercise.Sets) Validation.LoggedSet(set.WeightKg, set.Reps, set.Rpe, set.Done);
            await catalog.RequireActive(exercise.ExerciseId, ct);
        }

        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        Validation.Require(session!.Active, "This workout is already saved to your history.", 409);
        TemplateService.RequireFresh(input.Revision, session.Revision);
        session.Note = input.Note?.Trim() ?? ""; session.Revision++;

        var existing = await db.SessionExercises.Where(e => e.SessionId == id).ToListAsync(ct);
        var existingIds = existing.Select(e => e.Id).ToList();
        db.Sets.RemoveRange(await db.Sets.Where(s => existingIds.Contains(s.SessionExerciseId)).ToListAsync(ct));
        db.SessionExercises.RemoveRange(existing);
        var position = 0;
        foreach (var exercise in input.Exercises)
        {
            var row = new SessionExercise
            {
                UserId = session.UserId, SessionId = id, ExerciseId = exercise.ExerciseId, Position = position++,
                NameSnapshot = exercise.NameSnapshot.Trim(), Note = exercise.Note?.Trim() ?? "", PrescriptionJson = Json.Write(exercise.Prescription)
            };
            db.SessionExercises.Add(row);
            var setPosition = 0;
            foreach (var set in exercise.Sets)
                db.Sets.Add(new CompletedSet { UserId = session.UserId, SessionExerciseId = row.Id, Position = setPosition++, WeightKg = set.WeightKg, Reps = set.Reps, Rpe = set.Rpe, Done = set.Done });
        }
        await templates.Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    /// Finishing keeps only completed sets, so a planned set the user never performed
    /// does not enter history or any volume figure.
    public async Task<SessionView> Finish(Guid id, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        Validation.Require(session!.Active, "This workout is already saved to your history.", 409);
        TemplateService.RequireFresh(revision, session.Revision);
        var exercises = await db.SessionExercises.Where(e => e.SessionId == id).ToListAsync(ct);
        var ids = exercises.Select(e => e.Id).ToList();
        var sets = await db.Sets.Where(s => ids.Contains(s.SessionExerciseId)).ToListAsync(ct);
        Validation.Require(sets.Any(s => s.Done), "Complete at least one set to save this workout.");
        db.Sets.RemoveRange(sets.Where(s => !s.Done));
        foreach (var exercise in exercises.Where(e => !sets.Any(s => s.Done && s.SessionExerciseId == e.Id))) db.SessionExercises.Remove(exercise);
        session.Active = false; session.FinishedAt = DateTime.UtcNow; session.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    public async Task Discard(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        Validation.Require(session!.Active, "A saved workout is deleted from your history, not discarded.", 409);
        await Remove(session, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public async Task DeleteFromHistory(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id && !w.Active, ct);
        Validation.Require(session != null, "That workout is not in your history.", 404);
        await Remove(session!, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task Remove(WorkoutSession session, CancellationToken ct)
    {
        var ids = await db.SessionExercises.Where(e => e.SessionId == session.Id).Select(e => e.Id).ToListAsync(ct);
        db.Sets.RemoveRange(await db.Sets.Where(s => ids.Contains(s.SessionExerciseId)).ToListAsync(ct));
        db.SessionExercises.RemoveRange(await db.SessionExercises.Where(e => e.SessionId == session.Id).ToListAsync(ct));
        db.Workouts.Remove(session);
    }

    public async Task<HistoryPage> History(int page, int size, CancellationToken ct)
    {
        Validation.Require(page >= 0 && size is > 0 and <= 100, "Invalid page request.");
        var query = db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null).OrderByDescending(w => w.FinishedAt);
        var total = await query.CountAsync(ct);
        var rows = await query.Skip(page * size).Take(size).ToListAsync(ct);
        var views = new List<SessionView>();
        foreach (var row in rows) views.Add(await View(row, ct));
        return new HistoryPage(total, page, size, views);
    }
}

public record HistoryPage(int Total, int Page, int Size, List<SessionView> Sessions);
