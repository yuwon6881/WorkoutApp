using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// The signed-in user's load rules, read once so a whole catalog or session resolves against
/// one consistent snapshot. Equipment defaults are a handful of rows per user.
public sealed class LoadRuleSnapshot(
    Dictionary<Guid, LoadRule> exercises,
    Dictionary<string, LoadRule> equipment,
    string unit = "kg")
{
    public string Unit => unit;

    public ResolvedLoad Resolve(Guid exerciseId, double appStepKg, string? equipmentName, string? loadModel)
    {
        var group = EquipmentGroups.For(equipmentName, loadModel);
        return LoadResolution.Resolve(EquipmentGroups.ExerciseAppDefault(appStepKg, equipmentName, loadModel, unit), group, exercises.GetValueOrDefault(exerciseId),
            group is null ? null : equipment.GetValueOrDefault(group));
    }

    public ResolvedLoad ResolveGroup(string group)
        => LoadResolution.Resolve(EquipmentGroups.AppDefaultStep(group, unit), group, null, equipment.GetValueOrDefault(group));
}

public static class LoadRuleReader
{
    /// Null exerciseIds reads every exercise setting, for the whole catalog.
    public static async Task<LoadRuleSnapshot> Read(AppDb db, IReadOnlyCollection<Guid>? exerciseIds, CancellationToken ct)
    {
        var settingsQuery = db.ExerciseLoadSettings.AsNoTracking();
        if (exerciseIds is not null) settingsQuery = settingsQuery.Where(x => exerciseIds.Contains(x.Id));
        var settings = await settingsQuery.ToListAsync(ct);
        var defaults = await db.EquipmentLoadDefaults.AsNoTracking().ToListAsync(ct);
        var user = db.CurrentUser is null ? null : await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == db.CurrentUser, ct);
        var unit = user?.Unit ?? "kg";
        return new LoadRuleSnapshot(
            settings.ToDictionary(x => x.Id, x => Rule(x.LoadStepKg, x.AvailableLoadsJson)),
            defaults.ToDictionary(x => x.Equipment, x => Rule(x.LoadStepKg, x.AvailableLoadsJson)),
            unit);
    }

    public static LoadRule Rule(double? stepKg, string? loadsJson) => new(stepKg, Loads(loadsJson));

    public static List<double>? Loads(string? json) => json is null ? null : Json.Read<List<double>>(json);
}
