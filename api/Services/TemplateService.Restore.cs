using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record TemplateExerciseBaseline(
    Guid SlotKey,
    Guid? ExerciseId,
    string SourceName,
    string Note,
    int Position,
    string SetsJson,
    string SequenceGroup,
    string SubstitutionsJson,
    int? SourcePage = null);

public record TemplateBaseline(
    string Name,
    string Focus,
    string Note,
    List<TemplateExerciseBaseline> Exercises,
    bool IsLegacy = false);

public record TemplateSubstitutionRestoreInput(
    Guid? TemplateExerciseId,
    Guid? SlotKey,
    string Scope = "slot",
    int? Revision = null,
    Guid? IdempotencyId = null);

public sealed partial class TemplateService
{
    public static string CreateTemplateBaseline(WorkoutTemplate template, IEnumerable<TemplateExercise> exercises, bool isLegacy = false)
    {
        var list = exercises.OrderBy(e => e.Position).Select(e => new TemplateExerciseBaseline(
            e.SlotKey, e.ExerciseId, e.SourceName, e.Note, e.Position,
            e.SetsJson, e.SequenceGroup, e.SubstitutionsJson, e.SourcePage)).ToList();

        return Json.Write(new TemplateBaseline(template.Name, template.Focus, template.Note, list, isLegacy));
    }

    public static void EnsureBaseline(WorkoutTemplate template, List<TemplateExercise> exercises)
    {
        if (string.IsNullOrEmpty(template.BaselineJson))
        {
            template.BaselineJson = CreateTemplateBaseline(template, exercises, isLegacy: true);
        }
    }

    public async Task<TemplateSubstitutionResult> PreviewRestore(Guid templateId, TemplateSubstitutionRestoreInput input, CancellationToken ct)
    {
        Validation.Require(input.Scope is "slot" or "phase", "Substitution scope must be slot or phase.");
        Validation.Require(input.TemplateExerciseId is not null || input.SlotKey is not null, "Choose an exercise slot before restoring.");
        var template = await db.Templates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == templateId, ct);
        Validation.Require(template != null, "That workout no longer exists.", 404);
        var target = await db.TemplateExercises.AsNoTracking().SingleOrDefaultAsync(e => e.TemplateId == templateId &&
            (input.TemplateExerciseId == null || e.Id == input.TemplateExerciseId) && (input.SlotKey == null || e.SlotKey == input.SlotKey), ct);
        Validation.Require(target != null, "That exercise slot no longer exists.", 404);

        var templateRow = template!;
        var targetRow = target!;
        var candidates = new List<WorkoutTemplate> { templateRow };

        if (input.Scope == "phase")
        {
            Validation.Require(templateRow.ProgramId is not null, "Phase substitutions are available for saved programs only.", 409);
            var phase = templateRow.ProgramPhaseId is { } phaseId
                ? await db.ProgramPhases.AsNoTracking().SingleOrDefaultAsync(p => p.Id == phaseId, ct)
                : (await db.ProgramPhases.AsNoTracking().Where(p => p.ProgramId == templateRow.ProgramId).ToListAsync(ct)).Where(p =>
                    templateRow.Week >= p.WeekFrom && templateRow.Week <= p.WeekTo && p.Block == templateRow.Block &&
                    (string.IsNullOrWhiteSpace(templateRow.Phase) || p.Name == templateRow.Phase)).SingleOrDefault();
            Validation.Require(phase is not null, "This phase target is ambiguous. Refresh the program before restoring exercises.", 409);
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

        var baselineExercise = ResolveBaselineExercise(templateRow, targetRow.SlotKey, targetRow.Position);
        var originalName = baselineExercise?.SourceName ?? targetRow.SourceName;
        var originalId = baselineExercise?.ExerciseId;

        return new TemplateSubstitutionResult(await Get(templateId, ct), input.Scope, affected, originalId, originalName);
    }

    public async Task<TemplateSubstitutionResult> RestoreSubstitution(Guid templateId, TemplateSubstitutionRestoreInput input, CancellationToken ct)
    {
        Validation.Require(input.Scope is "slot" or "phase", "Substitution scope must be slot or phase.");
        Validation.Require(input.TemplateExerciseId is not null || input.SlotKey is not null, "Choose an exercise slot before restoring.");
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var template = await db.Templates.SingleOrDefaultAsync(t => t.Id == templateId, ct);
        Validation.Require(template != null, "That workout no longer exists.", 404);
        var templateRow = template!;
        RequireFresh(input.Revision, templateRow.Revision);

        var existingExercises = await db.TemplateExercises.Where(e => e.TemplateId == templateId).OrderBy(e => e.Position).ToListAsync(ct);
        EnsureBaseline(templateRow, existingExercises);

        var target = existingExercises.SingleOrDefault(e =>
            (input.TemplateExerciseId == null || e.Id == input.TemplateExerciseId) &&
            (input.SlotKey == null || e.SlotKey == input.SlotKey));
        Validation.Require(target != null, "That exercise slot no longer exists.", 404);
        var targetRow = target!;

        var baselineExercise = ResolveBaselineExercise(templateRow, targetRow.SlotKey, targetRow.Position);
        Validation.Require(baselineExercise != null, "This exercise has no baseline default to restore.", 409);
        var targetBaseline = baselineExercise!;

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
                Validation.Require(matches.Count == 1, "This phase target is ambiguous. Refresh the program before restoring exercises.", 409);
                phaseRow = matches[0]; phaseId = phaseRow.Id; templateRow.ProgramPhaseId = phaseId;
            }
            phaseRow ??= await db.ProgramPhases.SingleOrDefaultAsync(p => p.Id == phaseId, ct);
            Validation.Require(phaseRow is not null, "That phase no longer exists. Refresh the program before restoring exercises.", 409);
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
            var row = await db.TemplateExercises.SingleOrDefaultAsync(e => e.TemplateId == rowTemplate.Id &&
                (e.SlotKey == targetRow.SlotKey || (input.Scope == "phase" && e.Position == targetPosition)), ct);
            if (row is null) continue;

            var slotBaseline = ResolveBaselineExercise(rowTemplate, row.SlotKey, row.Position) ?? targetBaseline;
            row.ExerciseId = slotBaseline.ExerciseId;
            row.SourceName = slotBaseline.SourceName;
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
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return new TemplateSubstitutionResult(await Get(templateId, ct), input.Scope, affected, targetBaseline.ExerciseId, targetBaseline.SourceName);
    }

    public async Task<TemplateView> RestoreTemplate(Guid id, int? revision, Guid? idempotencyId, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var template = await db.Templates.SingleOrDefaultAsync(t => t.Id == id, ct);
        Validation.Require(template != null, "That workout no longer exists.", 404);
        var templateRow = template!;
        RequireFresh(revision, templateRow.Revision);

        var existing = await db.TemplateExercises.Where(e => e.TemplateId == id).OrderBy(e => e.Position).ToListAsync(ct);
        EnsureBaseline(templateRow, existing);

        var baseline = Json.Read<TemplateBaseline>(templateRow.BaselineJson);
        templateRow.Name = baseline.Name;
        templateRow.Focus = baseline.Focus;
        templateRow.Note = baseline.Note;
        templateRow.Revision++;

        db.TemplateExercises.RemoveRange(existing);
        foreach (var bEx in baseline.Exercises)
        {
            db.TemplateExercises.Add(new TemplateExercise
            {
                UserId = templateRow.UserId,
                TemplateId = id,
                ExerciseId = bEx.ExerciseId,
                SourceName = bEx.SourceName,
                Note = bEx.Note,
                Position = bEx.Position,
                SetsJson = bEx.SetsJson,
                SequenceGroup = bEx.SequenceGroup,
                SubstitutionsJson = bEx.SubstitutionsJson,
                SourcePage = bEx.SourcePage,
                SlotKey = bEx.SlotKey
            });
        }

        await Receipt(idempotencyId, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    public static TemplateExerciseBaseline? ResolveBaselineExercise(WorkoutTemplate template, Guid slotKey, int position)
    {
        if (string.IsNullOrEmpty(template.BaselineJson)) return null;
        var baseline = Json.Read<TemplateBaseline>(template.BaselineJson);
        return baseline.Exercises.FirstOrDefault(e => e.SlotKey == slotKey)
            ?? baseline.Exercises.FirstOrDefault(e => e.Position == position);
    }
}
