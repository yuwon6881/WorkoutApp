using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// The signed-in user's load rules at their active gym, read once so a whole catalog or session
/// resolves against one consistent snapshot. Equipment defaults are a handful of rows per gym.
/// Every rule is read in the account unit; the stored rows keep the unit they were typed in.
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

public sealed record AccountLoadContext(string Unit, Guid? ActiveGymProfileId, bool TrackRir);

public static class LoadRuleReader
{
    /// Null exerciseIds reads every exercise setting, for the whole catalog. A unit reads the rules
    /// as that unit displays them; without one they follow the account unit.
    public static async Task<LoadRuleSnapshot> Read(AppDb db, IReadOnlyCollection<Guid>? exerciseIds, CancellationToken ct,
        string? unit = null, AccountLoadContext? account = null)
    {
        if (unit is not null) Validation.Unit(unit);
        if (db.CurrentUser is null)
            return new LoadRuleSnapshot([], [], unit ?? WeightUnits.Kg);

        account ??= await ReadAccountContext(db, ct);
        var resolvedUnit = unit ?? account.Unit;
        // Before the first gym exists no rule can have been saved, so skip load-rule table queries.
        var gym = await GymProfiles.ResolveActiveId(db, account.ActiveGymProfileId, ct);
        if (gym is null)
            return new LoadRuleSnapshot([], [], resolvedUnit);

        var settings = exerciseIds is { Count: 0 }
            ? []
            : await (exerciseIds is null
                ? db.ExerciseLoadSettings.AsNoTracking().Where(x => x.GymProfileId == gym)
                : db.ExerciseLoadSettings.AsNoTracking().Where(x => x.GymProfileId == gym && exerciseIds.Contains(x.Id)))
                .ToListAsync(ct);
        var defaults = await db.EquipmentLoadDefaults.AsNoTracking().Where(x => x.GymProfileId == gym).ToListAsync(ct);
        return new LoadRuleSnapshot(
            settings.ToDictionary(x => x.Id, x => Rule(x.LoadStepKg, x.AvailableLoadsJson, x.LoadStepUnit)),
            defaults.ToDictionary(x => x.Equipment, x => Rule(x.LoadStepKg, x.AvailableLoadsJson, x.LoadStepUnit)),
            resolvedUnit);
    }

    public static async Task<AccountLoadContext> ReadAccountContext(AppDb db, CancellationToken ct)
    {
        if (db.CurrentUser is not { } userId)
            return new AccountLoadContext(WeightUnits.Kg, null, false);
        var row = await db.Users.AsNoTracking().Where(x => x.Id == userId)
            .Select(x => new { x.Unit, x.ActiveGymProfileId, x.TrackRir })
            .SingleOrDefaultAsync(ct);
        return row is null
            ? new AccountLoadContext(WeightUnits.Kg, null, false)
            : new AccountLoadContext(row.Unit, row.ActiveGymProfileId, row.TrackRir);
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
