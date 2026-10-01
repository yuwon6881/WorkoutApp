using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Unit is the one the step was typed in; without it the account unit is assumed.
public record LoadRuleInput(double? LoadStepKg, List<double>? AvailableLoadsKg, int Revision, string? Unit = null);
public record EquipmentLoadView(string Group, double AppDefaultStepKg, double? OwnStepKg, List<double>? OwnAvailableLoadsKg,
    double StepKg, List<double>? AvailableLoadsKg, string Source, int Revision, int ExerciseCount);
public record LoadSettingsView(List<EquipmentLoadView> Equipment);

/// Account equipment defaults. Individual exercise rules are edited with that exercise.
public sealed class LoadSettingsService(AppDb db, CatalogService catalog)
{
    public async Task<LoadSettingsView> Get(CancellationToken ct, string? unit = null)
    {
        var exercises = await catalog.All(ct);
        var rules = await LoadRuleReader.Read(db, [], ct, unit);
        var defaults = await db.EquipmentLoadDefaults.AsNoTracking().ToDictionaryAsync(x => x.Equipment, ct);
        var groupSizes = exercises.Select(x => EquipmentGroups.For(x.Equipment, x.LoadModel))
            .Where(group => group is not null).GroupBy(group => group!).ToDictionary(g => g.Key, g => g.Count());
        var equipment = EquipmentGroups.All.Select(group =>
        {
            defaults.TryGetValue(group, out var row);
            var resolved = rules.ResolveGroup(group);
            return new EquipmentLoadView(group, EquipmentGroups.AppDefaultStep(group, rules.Unit), rules.EquipmentRule(group)?.StepKg,
                LoadRuleReader.Loads(row?.AvailableLoadsJson), resolved.StepKg, resolved.AvailableLoadsKg?.ToList(),
                resolved.Source, row?.Revision ?? 0, groupSizes.GetValueOrDefault(group));
        }).ToList();
        return new LoadSettingsView(equipment);
    }

    /// Both fields empty restores the app default for the group.
    public async Task<LoadSettingsView> SaveEquipment(string group, LoadRuleInput input, CancellationToken ct)
    {
        Validation.Require(EquipmentGroups.IsKnown(group), "That equipment type has no weight settings.", 404);
        var (step, loadsJson) = LoadRuleValidation.Normalize(input.LoadStepKg, input.AvailableLoadsKg);
        var unit = await LoadRuleReader.ReadingUnit(db, input.Unit, ct);
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var row = await db.EquipmentLoadDefaults.SingleOrDefaultAsync(x => x.Equipment == group, ct);
            Validation.Require(input.Revision == (row?.Revision ?? 0),
                "These weight settings changed elsewhere. Reload them before saving again.", 409);
            if (row is null)
            {
                row = new EquipmentLoadDefault { UserId = db.CurrentUser!.Value, Equipment = group };
                db.EquipmentLoadDefaults.Add(row);
            }
            row.LoadStepKg = step;
            row.LoadStepUnit = unit;
            row.AvailableLoadsJson = loadsJson;
            row.Revision++;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        return await Get(ct, unit);
    }
}
