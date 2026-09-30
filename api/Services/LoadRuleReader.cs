using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// The signed-in user's load rules, read once so a whole catalog or session resolves against
/// one consistent snapshot. Equipment defaults and stacks are a handful of rows per user.
public sealed class LoadRuleSnapshot(
    Dictionary<Guid, LoadRule> exercises,
    Dictionary<string, LoadRule> equipment,
    Dictionary<Guid, LoadStackRule> stacks)
{
    public IReadOnlyDictionary<Guid, LoadStackRule> Stacks => stacks;

    public ResolvedLoad Resolve(Guid exerciseId, double appStepKg, string? equipmentName, string? loadModel)
    {
        var group = EquipmentGroups.For(equipmentName, loadModel);
        return LoadResolution.Resolve(appStepKg, group, exercises.GetValueOrDefault(exerciseId),
            group is null ? null : equipment.GetValueOrDefault(group), stacks);
    }

    public ResolvedLoad ResolveGroup(string group)
        => LoadResolution.Resolve(EquipmentGroups.AppDefaultStep(group), group, null, equipment.GetValueOrDefault(group), stacks);
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
        var stacks = await db.LoadStacks.AsNoTracking().ToListAsync(ct);
        return new LoadRuleSnapshot(
            settings.ToDictionary(x => x.Id, x => Rule(x.LoadStepKg, x.AvailableLoadsJson, x.StackId)),
            defaults.ToDictionary(x => x.Equipment, x => Rule(x.LoadStepKg, x.AvailableLoadsJson, x.StackId)),
            stacks.ToDictionary(x => x.Id, x => new LoadStackRule(x.Id, x.Name, x.LoadStepKg, Loads(x.AvailableLoadsJson))));
    }

    public static LoadRule Rule(double? stepKg, string? loadsJson, Guid? stackId) => new(stepKg, Loads(loadsJson), stackId);

    public static List<double>? Loads(string? json) => json is null ? null : Json.Read<List<double>>(json);
}
