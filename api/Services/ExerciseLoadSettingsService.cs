using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Unit is the one the step was typed in; without it the account unit is assumed.
public record ExerciseLoadSettingsInput(double? LoadStepKg, List<double>? AvailableLoadsKg, int Revision, string? Unit = null);

/// The rule the exercise would use without its own setting: the account's equipment rule or the app default.
public record InheritedLoadView(double StepKg, List<double>? AvailableLoadsKg, string Source, string? EquipmentGroup);

/// LoadStepKg and AvailableLoadsKg are what progression uses now. The exercise's own rule is
/// OwnStepKg or OwnAvailableLoadsKg; none of them means it inherits.
public record ExerciseLoadSettingsView(double LoadStepKg, List<double>? AvailableLoadsKg,
    double DefaultStepKg, bool IsCustomized, int Revision,
    double? OwnStepKg = null, List<double>? OwnAvailableLoadsKg = null,
    string Source = LoadSources.App, InheritedLoadView? Inherited = null);

/// The exercise's own default step, in the unit it was stored in.
internal sealed record ExerciseLoadTarget(double AppStepKg, string AppStepUnit, string Equipment, string LoadModel);

public sealed class ExerciseLoadSettingsService(AppDb db)
{
    public async Task<ExerciseLoadSettingsView> Get(Guid id, CancellationToken ct, string? unit = null)
    {
        var exercise = await Exercise(id, ct);
        var row = await db.ExerciseLoadSettings.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        return await View(id, exercise, row, unit, ct);
    }

    public async Task<ExerciseLoadSettingsView> Save(Guid id, ExerciseLoadSettingsInput input, CancellationToken ct)
    {
        var (step, loadsJson) = LoadRuleValidation.Normalize(input.LoadStepKg, input.AvailableLoadsKg);
        var unit = await LoadRuleReader.ReadingUnit(db, input.Unit, ct);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var exercise = await Exercise(id, ct);
        var row = await db.ExerciseLoadSettings.SingleOrDefaultAsync(x => x.Id == id, ct);
        Validation.Require(input.Revision == (row?.Revision ?? 0),
            "These weight settings changed elsewhere. Reload them before saving again.", 409);
        if (row is null)
        {
            row = new ExerciseLoadSetting { UserId = db.CurrentUser!.Value, Id = id };
            db.ExerciseLoadSettings.Add(row);
        }
        row.LoadStepKg = step;
        row.LoadStepUnit = unit;
        row.AvailableLoadsJson = loadsJson;
        row.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await View(id, exercise, row, unit, ct);
    }

    private async Task<ExerciseLoadTarget> Exercise(Guid id, CancellationToken ct)
    {
        var catalog = await db.Exercises.Where(x => x.Id == id && x.Active)
            .Select(x => new ExerciseLoadTarget(x.LoadStepKg, WeightUnits.Kg, x.Equipment, x.LoadModel)).SingleOrDefaultAsync(ct);
        if (catalog is not null) return catalog;
        var custom = await db.CustomExercises.Where(x => x.Id == id && !x.Archived)
            .Select(x => new ExerciseLoadTarget(x.LoadStepKg, x.LoadStepUnit, x.Equipment, x.LoadModel)).SingleOrDefaultAsync(ct);
        Validation.Require(custom is not null, "That exercise is no longer available.", 404);
        return custom!;
    }

    private async Task<ExerciseLoadSettingsView> View(Guid id, ExerciseLoadTarget exercise, ExerciseLoadSetting? row,
        string? unit, CancellationToken ct)
    {
        var rules = await LoadRuleReader.Read(db, [id], ct, unit);
        var effective = rules.Resolve(id, exercise.AppStepKg, exercise.Equipment, exercise.LoadModel, exercise.AppStepUnit);
        var inherited = rules.ResolveInherited(exercise.AppStepKg, exercise.Equipment, exercise.LoadModel, exercise.AppStepUnit);
        var customized = row is not null && (row.LoadStepKg is not null || row.AvailableLoadsJson is not null);
        return new ExerciseLoadSettingsView(effective.StepKg, effective.AvailableLoadsKg?.ToList(), inherited.StepKg, customized,
            row?.Revision ?? 0, rules.ExerciseRule(id, exercise.Equipment)?.StepKg, LoadRuleReader.Loads(row?.AvailableLoadsJson),
            effective.Source,
            new InheritedLoadView(inherited.StepKg, inherited.AvailableLoadsKg?.ToList(), inherited.Source, inherited.EquipmentGroup));
    }
}
