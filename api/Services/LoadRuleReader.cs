using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// The signed-in user's load rules, read once so a whole catalog or session resolves against
/// one consistent snapshot. Equipment defaults are a handful of rows per user. Every rule is
/// read in the account unit; the stored rows keep the unit they were typed in.
public sealed class LoadRuleSnapshot(
    Dictionary<Guid, LoadRule> exercises,
    Dictionary<string, LoadRule> equipment,
    string unit = WeightUnits.Kg)
{
    public string Unit => unit;

    /// appStepUnit is the unit a custom exercise stored its default in; catalog defaults are kg.
    public ResolvedLoad Resolve(Guid exerciseId, double appStepKg, string? equipmentName, string? loadModel,
        string appStepUnit = WeightUnits.Kg)
    {
        var group = EquipmentGroups.For(equipmentName, loadModel);
        return LoadResolution.Resolve(AppStep(appStepKg, equipmentName, loadModel, appStepUnit), group,
            ExerciseRule(exerciseId, equipmentName), EquipmentRule(group));
    }

    /// What the exercise would use without its own rule.
    public ResolvedLoad ResolveInherited(double appStepKg, string? equipmentName, string? loadModel,
        string appStepUnit = WeightUnits.Kg)
    {
        var group = EquipmentGroups.For(equipmentName, loadModel);
        return LoadResolution.Resolve(AppStep(appStepKg, equipmentName, loadModel, appStepUnit), group, null, EquipmentRule(group));
    }

    public ResolvedLoad ResolveGroup(string group)
        => LoadResolution.Resolve(EquipmentGroups.AppDefaultStep(group, unit), group, null, EquipmentRule(group));

    public LoadRule? ExerciseRule(Guid exerciseId, string? equipmentName)
        => exercises.GetValueOrDefault(exerciseId)?.In(unit, equipmentName);

    public LoadRule? EquipmentRule(string? group)
        => group is null ? null : equipment.GetValueOrDefault(group)?.In(unit, group);

    private double AppStep(double appStepKg, string? equipmentName, string? loadModel, string appStepUnit)
        => EquipmentGroups.ExerciseAppDefault(appStepKg, equipmentName, loadModel, unit, appStepUnit);
}

public static class LoadRuleReader
{
    /// Null exerciseIds reads every exercise setting, for the whole catalog. A unit reads the rules
    /// as that unit displays them; without one they follow the account unit.
    public static async Task<LoadRuleSnapshot> Read(AppDb db, IReadOnlyCollection<Guid>? exerciseIds, CancellationToken ct,
        string? unit = null)
    {
        var settingsQuery = db.ExerciseLoadSettings.AsNoTracking();
        if (exerciseIds is not null) settingsQuery = settingsQuery.Where(x => exerciseIds.Contains(x.Id));
        var settings = await settingsQuery.ToListAsync(ct);
        var defaults = await db.EquipmentLoadDefaults.AsNoTracking().ToListAsync(ct);
        return new LoadRuleSnapshot(
            settings.ToDictionary(x => x.Id, x => Rule(x.LoadStepKg, x.AvailableLoadsJson, x.LoadStepUnit)),
            defaults.ToDictionary(x => x.Equipment, x => Rule(x.LoadStepKg, x.AvailableLoadsJson, x.LoadStepUnit)),
            await ReadingUnit(db, unit, ct));
    }

    /// The unit a request reads or types load steps in: the one it names, else the account's.
    public static async Task<string> ReadingUnit(AppDb db, string? unit, CancellationToken ct)
    {
        if (unit is null) return await AccountUnit(db, ct);
        Validation.Unit(unit);
        return unit;
    }

    /// The signed-in account's display unit; kilograms when nobody is signed in.
    public static async Task<string> AccountUnit(AppDb db, CancellationToken ct)
        => db.CurrentUser is null ? WeightUnits.Kg
            : await db.Users.AsNoTracking().Where(x => x.Id == db.CurrentUser).Select(x => x.Unit).SingleOrDefaultAsync(ct) ?? WeightUnits.Kg;

    public static LoadRule Rule(double? stepKg, string? loadsJson, string unit = WeightUnits.Kg) => new(stepKg, Loads(loadsJson), unit);

    public static List<double>? Loads(string? json) => json is null ? null : Json.Read<List<double>>(json);
}
