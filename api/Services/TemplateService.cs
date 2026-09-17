using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record TemplateExerciseInput(Guid? ExerciseId, string SourceName, string? Note, List<SetPrescription> Sets,
    string? SequenceGroup = null, List<string>? Substitutions = null, int? SourcePage = null, Guid? SlotKey = null);
public record TemplateInput(string Name, string? Focus, string? Note, List<TemplateExerciseInput> Exercises, int? Revision, Guid? IdempotencyId,
    string? Block = null, string? Phase = null, int PhaseWeek = 1, bool IsRestDay = false);
public record TemplateExerciseView(Guid Id, Guid? ExerciseId, string SourceName, string Name, string Note, int Position, List<SetPrescription> Sets,
    string SequenceGroup = "", List<string>? Substitutions = null, string LoadModel = LoadModels.External, int? SourcePage = null, Guid? SlotKey = null);
public record TemplateView(Guid Id, Guid? ProgramId, string Name, string Focus, string Note, int Week, int Position, int Revision, List<TemplateExerciseView> Exercises,
    string Block = "", string Phase = "", int PhaseWeek = 1, bool IsRestDay = false, int? Weekday = null, int? SourcePage = null, Guid? PhaseId = null);
public static class SubstitutionScope
{
    public const string Slot = "slot";
    public const string Phase = "phase";
}
public record TemplateSubstitutionInput(Guid? TemplateExerciseId, Guid? SlotKey, Guid? ReplacementExerciseId, string ReplacementName,
    string Scope = "slot", int? Revision = null, Guid? IdempotencyId = null);
public record SubstitutionAffectedSlot(Guid TemplateId, Guid TemplateExerciseId, Guid SlotKey, int Week, string WorkoutName);
public record TemplateSubstitutionResult(TemplateView Template, string Scope, List<SubstitutionAffectedSlot> AffectedSlots,
    Guid? ReplacementExerciseId = null, string ReplacementName = "");

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
        var models = await catalog.LoadModelsFor(rows.Select(r => r.ExerciseId), ct);
        return templates.Select(t => new TemplateView(t.Id, t.ProgramId, t.Name, t.Focus, t.Note, t.Week, t.Position, t.Revision,
            rows.Where(e => e.TemplateId == t.Id).Select(e => new TemplateExerciseView(e.Id, e.ExerciseId, e.SourceName,
                e.ExerciseId is { } id && names.TryGetValue(id, out var name) ? name : e.SourceName,
                e.Note, e.Position, Json.Read<List<SetPrescription>>(e.SetsJson), e.SequenceGroup,
                Json.Read<List<string>>(e.SubstitutionsJson), e.ExerciseId is { } modelId && models.TryGetValue(modelId, out var model) ? model : LoadModels.External, e.SourcePage, e.SlotKey)).ToList(),
            t.Block, t.Phase, t.PhaseWeek, t.IsRestDay, t.Weekday, t.SourcePage, t.ProgramPhaseId)).ToList();
    }

    public async Task<Dictionary<Guid, string>> CatalogNames(IEnumerable<Guid?> ids, CancellationToken ct)
    {
        var wanted = ids.Where(i => i != null).Select(i => i!.Value).Distinct().ToList();
        if (wanted.Count == 0) return [];
        var names = await db.Exercises.AsNoTracking().Where(x => wanted.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var custom = await db.CustomExercises.AsNoTracking().Where(x => wanted.Contains(x.Id)).ToListAsync(ct);
        foreach (var row in custom) names[row.Id] = row.Name;
        return names;
    }

    public async Task<TemplateView> Create(TemplateInput input, Guid? programId, int week, int position, CancellationToken ct)
    {
        await ValidateInput(input, ct);
        var template = new WorkoutTemplate
        {
            UserId = db.CurrentUser!.Value, ProgramId = programId, Name = input.Name.Trim(),
            Focus = input.Focus?.Trim() ?? "", Note = input.Note?.Trim() ?? "", Week = week, Position = position,
            Block = input.Block?.Trim() ?? "", Phase = input.Phase?.Trim() ?? "", PhaseWeek = input.PhaseWeek, IsRestDay = input.IsRestDay
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
        template.Block = input.Block?.Trim() ?? ""; template.Phase = input.Phase?.Trim() ?? ""; template.PhaseWeek = input.PhaseWeek; template.IsRestDay = input.IsRestDay;
        template.Revision++;
        var existing = await db.TemplateExercises.Where(e => e.TemplateId == id).OrderBy(e => e.Position).ToListAsync(ct);
        foreach (var legacy in existing.Where(e => e.SlotKey == Guid.Empty)) legacy.SlotKey = Guid.NewGuid();
        var bySlot = existing.GroupBy(e => e.SlotKey).ToDictionary(g => g.Key, g => g.First());
        var used = new HashSet<Guid>();
        var position = 0;
        foreach (var inputExercise in input.Exercises)
        {
            var row = inputExercise.SlotKey is { } slot && bySlot.TryGetValue(slot, out var stable)
                ? stable
                : existing.ElementAtOrDefault(position);
            row ??= new TemplateExercise { UserId = db.CurrentUser!.Value, TemplateId = id };
            if (inputExercise.SlotKey is { } supplied) row.SlotKey = supplied;
            row.ExerciseId = inputExercise.ExerciseId; row.SourceName = inputExercise.SourceName.Trim();
            row.Note = inputExercise.Note?.Trim() ?? ""; row.Position = position++;
            row.SetsJson = Json.Write(inputExercise.Sets); row.SequenceGroup = inputExercise.SequenceGroup?.Trim() ?? "";
            row.SubstitutionsJson = Json.Write((inputExercise.Substitutions ?? []).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).Take(2).ToList());
            row.SourcePage = inputExercise.SourcePage; used.Add(row.Id);
            if (!existing.Contains(row)) db.TemplateExercises.Add(row);
        }
        db.TemplateExercises.RemoveRange(existing.Where(e => !used.Contains(e.Id)));
        await Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    public async Task<TemplateSubstitutionResult> Swap(Guid templateId, TemplateSubstitutionInput input, CancellationToken ct)
    {
        Validation.Name(input.ReplacementName, "Replacement exercise", 160);
        Validation.Require(input.Scope is "slot" or "phase", "Substitution scope must be slot or phase.");
        Validation.Require(input.TemplateExerciseId is not null || input.SlotKey is not null, "Choose an exercise slot before swapping.");
        await catalog.RequireActive(input.ReplacementExerciseId, ct);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var template = await db.Templates.SingleOrDefaultAsync(t => t.Id == templateId, ct);
        Validation.Require(template != null, "That workout no longer exists.", 404);
        var templateRow = template!;
        RequireFresh(input.Revision, templateRow.Revision);
        var target = await db.TemplateExercises.SingleOrDefaultAsync(e => e.TemplateId == templateId &&
            (input.TemplateExerciseId == null || e.Id == input.TemplateExerciseId) &&
            (input.SlotKey == null || e.SlotKey == input.SlotKey), ct);
        Validation.Require(target != null, "That exercise slot no longer exists.", 404);
        var targetRow = target!;
        var replacement = input.ReplacementName.Trim();
        if (input.ReplacementExerciseId is { } replacementId)
            replacement = await db.Exercises.AsNoTracking().Where(e => e.Id == replacementId && e.Active).Select(e => e.Name).SingleAsync(ct);

        var templatesToChange = new List<WorkoutTemplate> { templateRow };
        if (input.Scope == "phase")
        {
            Validation.Require(templateRow.ProgramId is not null, "Phase substitutions are available for saved programs only.", 409);
            var phaseId = templateRow.ProgramPhaseId;
            ProgramPhase? phaseRow = null;
            if (phaseId is null)
            {
                var phases = await db.ProgramPhases.Where(p => p.ProgramId == templateRow.ProgramId).OrderBy(p => p.Position).ToListAsync(ct);
                var matches = phases.Where(p => templateRow.Week >= p.WeekFrom && templateRow.Week <= p.WeekTo &&
                    string.Equals(p.Block, templateRow.Block, StringComparison.OrdinalIgnoreCase) &&
                    (string.IsNullOrWhiteSpace(templateRow.Phase) || string.Equals(p.Name, templateRow.Phase, StringComparison.OrdinalIgnoreCase))).ToList();
                Validation.Require(matches.Count == 1, "This phase target is ambiguous. Refresh the program before swapping exercises.", 409);
                phaseRow = matches[0]; phaseId = phaseRow.Id; templateRow.ProgramPhaseId = phaseId;
            }
            phaseRow ??= await db.ProgramPhases.SingleOrDefaultAsync(p => p.Id == phaseId, ct);
            Validation.Require(phaseRow is not null, "That phase no longer exists. Refresh the program before swapping exercises.", 409);
            templatesToChange = await db.Templates.Where(t => t.ProgramId == templateRow.ProgramId && !t.IsRestDay &&
                t.Week >= phaseRow!.WeekFrom && t.Week <= phaseRow.WeekTo &&
                (t.ProgramPhaseId == phaseId || (t.ProgramPhaseId == null && t.Block == phaseRow.Block && t.Phase == templateRow.Phase)))
                .OrderBy(t => t.Week).ThenBy(t => t.Position).ToListAsync(ct);
            var completed = await db.Workouts.Where(w => w.ProgramId == templateRow.ProgramId && w.FinishedAt != null && w.TemplateId != null)
                .Select(w => w.TemplateId!.Value).ToHashSetAsync(ct);
            var active = await db.Workouts.Where(w => w.ProgramId == templateRow.ProgramId && w.Active && w.TemplateId != null)
                .Select(w => w.TemplateId!.Value).ToHashSetAsync(ct);
            var skipped = await db.ProgramSkips.Where(s => s.ProgramId == templateRow.ProgramId).Select(s => s.TemplateId).ToHashSetAsync(ct);
            templatesToChange = templatesToChange.Where(t => !completed.Contains(t.Id) && !active.Contains(t.Id) && !skipped.Contains(t.Id)).ToList();
            Validation.Require(templatesToChange.Count > 0, "There are no remaining workouts in this phase.", 409);
        }
        var affected = new List<SubstitutionAffectedSlot>();
        var targetPosition = targetRow.Position;
        foreach (var rowTemplate in templatesToChange)
        {
            if (rowTemplate.ProgramPhaseId is null && input.Scope == "phase") rowTemplate.ProgramPhaseId = templateRow.ProgramPhaseId;
            var row = await db.TemplateExercises.SingleOrDefaultAsync(e => e.TemplateId == rowTemplate.Id &&
                (e.SlotKey == targetRow.SlotKey || (input.Scope == "phase" && e.Position == targetPosition)), ct);
            if (row is null) continue;
            row.ExerciseId = input.ReplacementExerciseId; row.SourceName = replacement;
            rowTemplate.Revision++;
            affected.Add(new SubstitutionAffectedSlot(rowTemplate.Id, row.Id, row.SlotKey, rowTemplate.Week, rowTemplate.Name));
        }
        Validation.Require(affected.Count > 0, "No matching exercise slots remain in this scope.", 409);
        if (input.Scope == "phase" && templateRow.ProgramId is { } programId)
        {
            var program = await db.Programs.SingleAsync(p => p.Id == programId, ct);
            program.Revision++;
        }
        await Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct); await gate.Commit(ct);
        return new TemplateSubstitutionResult(await Get(templateId, ct), input.Scope, affected, input.ReplacementExerciseId, replacement);
    }

    /// Read-only phase preview used before a phase-wide edit is confirmed in the UI.
    public async Task<TemplateSubstitutionResult> Preview(Guid templateId, TemplateSubstitutionInput input, CancellationToken ct)
    {
        Validation.Require(input.Scope is "slot" or "phase", "Substitution scope must be slot or phase.");
        Validation.Require(input.TemplateExerciseId is not null || input.SlotKey is not null, "Choose an exercise slot before swapping.");
        var template = await db.Templates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == templateId, ct);
        Validation.Require(template != null, "That workout no longer exists.", 404);
        var target = await db.TemplateExercises.AsNoTracking().SingleOrDefaultAsync(e => e.TemplateId == templateId &&
            (input.TemplateExerciseId == null || e.Id == input.TemplateExerciseId) && (input.SlotKey == null || e.SlotKey == input.SlotKey), ct);
        Validation.Require(target != null, "That exercise slot no longer exists.", 404);
        var templateRow = template!; var targetRow = target!;
        var candidates = new List<WorkoutTemplate> { templateRow };
        if (input.Scope == "phase")
        {
            Validation.Require(templateRow.ProgramId is not null, "Phase substitutions are available for saved programs only.", 409);
            var phase = templateRow.ProgramPhaseId is { } phaseId
                ? await db.ProgramPhases.AsNoTracking().SingleOrDefaultAsync(p => p.Id == phaseId, ct)
                : (await db.ProgramPhases.AsNoTracking().Where(p => p.ProgramId == templateRow.ProgramId).ToListAsync(ct)).Where(p =>
                    templateRow.Week >= p.WeekFrom && templateRow.Week <= p.WeekTo && p.Block == templateRow.Block &&
                    (string.IsNullOrWhiteSpace(templateRow.Phase) || p.Name == templateRow.Phase)).SingleOrDefault();
            Validation.Require(phase is not null, "This phase target is ambiguous. Refresh the program before swapping exercises.", 409);
            candidates = await db.Templates.AsNoTracking().Where(t => t.ProgramId == templateRow.ProgramId && !t.IsRestDay &&
                t.Week >= phase!.WeekFrom && t.Week <= phase.WeekTo &&
                (t.ProgramPhaseId == phase.Id || (t.ProgramPhaseId == null && t.Block == phase.Block && t.Phase == templateRow.Phase)))
                .OrderBy(t => t.Week).ThenBy(t => t.Position).ToListAsync(ct);
            var completed = await db.Workouts.AsNoTracking().Where(w => w.ProgramId == templateRow.ProgramId && w.FinishedAt != null && w.TemplateId != null)
                .Select(w => w.TemplateId!.Value).ToHashSetAsync(ct);
            var active = await db.Workouts.AsNoTracking().Where(w => w.ProgramId == templateRow.ProgramId && w.Active && w.TemplateId != null)
                .Select(w => w.TemplateId!.Value).ToHashSetAsync(ct);
            var skipped = await db.ProgramSkips.AsNoTracking().Where(s => s.ProgramId == templateRow.ProgramId).Select(s => s.TemplateId).ToHashSetAsync(ct);
            candidates = candidates.Where(t => !completed.Contains(t.Id) && !active.Contains(t.Id) && !skipped.Contains(t.Id)).ToList();
        }
        var affected = new List<SubstitutionAffectedSlot>();
        var targetPosition = targetRow.Position;
        foreach (var candidate in candidates)
        {
            var row = await db.TemplateExercises.AsNoTracking().SingleOrDefaultAsync(e => e.TemplateId == candidate.Id &&
                (e.SlotKey == targetRow.SlotKey || (input.Scope == "phase" && e.Position == targetPosition)), ct);
            if (row is not null) affected.Add(new SubstitutionAffectedSlot(candidate.Id, row.Id, row.SlotKey, candidate.Week, candidate.Name));
        }
        return new TemplateSubstitutionResult(await Get(templateId, ct), input.Scope, affected, input.ReplacementExerciseId, input.ReplacementName.Trim());
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
                SetsJson = Json.Write(exercise.Sets), SequenceGroup = exercise.SequenceGroup?.Trim() ?? "",
                SubstitutionsJson = Json.Write((exercise.Substitutions ?? []).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).Take(2).ToList()),
                SourcePage = exercise.SourcePage, SlotKey = exercise.SlotKey ?? Guid.NewGuid()
            });
    }

    public async Task ValidateInput(TemplateInput input, CancellationToken ct, bool requireWorkingRpe = true,
        bool allowTargetRpeOutsideTrainingRange = false)
    {
        Validation.Name(input.Name, "Workout name");
        Validation.Text(input.Focus, 120, "Focus"); Validation.Text(input.Note, 2000, "Workout notes");
        Validation.Text(input.Block, 80, "Block"); Validation.Text(input.Phase, 120, "Phase");
        Validation.Require(input.PhaseWeek is > 0 and <= 104, "Phase week must be between 1 and 104.");
        Validation.Require(input.IsRestDay ? input.Exercises is { Count: 0 } : input.Exercises is { Count: > 0 },
            input.IsRestDay ? "A rest day cannot contain exercises." : "Add at least one exercise to this workout.");
        Validation.Require(input.Exercises.Count <= 40, "A workout can have at most 40 exercises.");
        var suppliedSlots = input.Exercises.Where(exercise => exercise.SlotKey is not null).Select(exercise => exercise.SlotKey!.Value).ToList();
        Validation.Require(suppliedSlots.Count == suppliedSlots.Distinct().Count(), "A workout cannot reuse an exercise slot key.");
        foreach (var exercise in input.Exercises)
        {
            Validation.Name(exercise.SourceName, "Exercise name", 160);
            Validation.Text(exercise.Note, 1000, "Exercise notes");
            Validation.Require(exercise.SourcePage is null || exercise.SourcePage.Value is > 0 and <= PdfInspection.MaxPages, "Exercise source page is invalid.");
            Validation.Text(exercise.SequenceGroup, 8, "Sequence group");
            Validation.Substitutions(exercise.Substitutions);
            Validation.Prescriptions(exercise.Sets, requireWorkingRpe, allowTargetRpeOutsideTrainingRange);
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
