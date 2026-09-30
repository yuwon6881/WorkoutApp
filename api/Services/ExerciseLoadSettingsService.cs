using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record ExerciseLoadSettingsInput(double? LoadStepKg, List<double>? AvailableLoadsKg, int Revision, Guid? StackId = null);

/// The rule the exercise would use without its own setting: the account's equipment rule or the app default.
public record InheritedLoadView(double StepKg, List<double>? AvailableLoadsKg, string Source, string? EquipmentGroup, string? StackName);

/// LoadStepKg and AvailableLoadsKg are what progression uses now. The exercise's own rule is
/// OwnStepKg, OwnAvailableLoadsKg or StackId; none of them means it inherits.
public record ExerciseLoadSettingsView(double LoadStepKg, List<double>? AvailableLoadsKg,
    double DefaultStepKg, bool IsCustomized, int Revision,
    double? OwnStepKg = null, List<double>? OwnAvailableLoadsKg = null, Guid? StackId = null,
    string Source = LoadSources.App, string? StackName = null, InheritedLoadView? Inherited = null);

public sealed class ExerciseLoadSettingsService(AppDb db)
{
    public async Task<ExerciseLoadSettingsView> Get(Guid id, CancellationToken ct)
    {
        var exercise = await Exercise(id, ct);
        var row = await db.ExerciseLoadSettings.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        return await View(id, exercise, row, ct);
    }

    public async Task<ExerciseLoadSettingsView> Save(Guid id, ExerciseLoadSettingsInput input, CancellationToken ct)
    {
        var (step, loadsJson, stackId) = LoadRuleValidation.Normalize(input.LoadStepKg, input.AvailableLoadsKg, input.StackId);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var exercise = await Exercise(id, ct);
        await LoadRuleValidation.RequireStack(db, stackId, ct);
        var row = await db.ExerciseLoadSettings.SingleOrDefaultAsync(x => x.Id == id, ct);
        Validation.Require(input.Revision == (row?.Revision ?? 0),
            "These weight settings changed elsewhere. Reload them before saving again.", 409);
        if (row is null)
        {
            row = new ExerciseLoadSetting { UserId = db.CurrentUser!.Value, Id = id };
            db.ExerciseLoadSettings.Add(row);
        }
        row.LoadStepKg = step;
        row.AvailableLoadsJson = loadsJson;
        row.StackId = stackId;
        row.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await View(id, exercise, row, ct);
    }

    private async Task<(double AppStepKg, string Equipment, string LoadModel)> Exercise(Guid id, CancellationToken ct)
    {
        var catalog = await db.Exercises.Where(x => x.Id == id && x.Active)
            .Select(x => new { x.LoadStepKg, x.Equipment, x.LoadModel }).SingleOrDefaultAsync(ct);
        if (catalog is not null) return (catalog.LoadStepKg, catalog.Equipment, catalog.LoadModel);
        var custom = await db.CustomExercises.Where(x => x.Id == id && !x.Archived)
            .Select(x => new { x.LoadStepKg, x.Equipment, x.LoadModel }).SingleOrDefaultAsync(ct);
        Validation.Require(custom is not null, "That exercise is no longer available.", 404);
        return (custom!.LoadStepKg, custom.Equipment, custom.LoadModel);
    }

    private async Task<ExerciseLoadSettingsView> View(Guid id, (double AppStepKg, string Equipment, string LoadModel) exercise,
        ExerciseLoadSetting? row, CancellationToken ct)
    {
        var rules = await LoadRuleReader.Read(db, [id], ct);
        var effective = rules.Resolve(id, exercise.AppStepKg, exercise.Equipment, exercise.LoadModel);
        var group = EquipmentGroups.For(exercise.Equipment, exercise.LoadModel);
        var equipmentRule = group is null ? null : await db.EquipmentLoadDefaults.AsNoTracking()
            .Where(x => x.Equipment == group).Select(x => new { x.LoadStepKg, x.AvailableLoadsJson, x.StackId }).SingleOrDefaultAsync(ct);
        var inherited = LoadResolution.Resolve(exercise.AppStepKg, group, null,
            equipmentRule is null ? null : LoadRuleReader.Rule(equipmentRule.LoadStepKg, equipmentRule.AvailableLoadsJson, equipmentRule.StackId),
            rules.Stacks);
        var customized = row is not null && (row.LoadStepKg is not null || row.AvailableLoadsJson is not null || row.StackId is not null);
        return new ExerciseLoadSettingsView(effective.StepKg, effective.AvailableLoadsKg?.ToList(), inherited.StepKg, customized,
            row?.Revision ?? 0, row?.LoadStepKg, LoadRuleReader.Loads(row?.AvailableLoadsJson), row?.StackId,
            effective.Source, effective.StackName,
            new InheritedLoadView(inherited.StepKg, inherited.AvailableLoadsKg?.ToList(), inherited.Source, inherited.EquipmentGroup, inherited.StackName));
    }
}
