using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Unit is the one the step was typed in; without it the account unit is assumed.
public record LoadRuleInput(double? LoadStepKg, List<double>? AvailableLoadsKg, int Revision, string? Unit = null, Guid? GymProfileId = null);
public record EquipmentLoadView(string Group, double AppDefaultStepKg, double? OwnStepKg, List<double>? OwnAvailableLoadsKg,
    double StepKg, List<double>? AvailableLoadsKg, string Source, int Revision, int ExerciseCount);
public record LoadSettingsView(List<EquipmentLoadView> Equipment, Guid GymProfileId);

/// Equipment defaults at the selected gym, or the active gym for unscoped callers.
public sealed class LoadSettingsService(AppDb db, CatalogService catalog)
{
    public async Task<LoadSettingsView> Get(CancellationToken ct, string? unit = null, Guid? gymProfileId = null)
        => await Read(gymProfileId is { } gym ? await RequireGym(gym, ct) : await GymProfiles.ActiveId(db, ct) ?? Guid.Empty, ct, unit);

    private async Task<Guid> RequireGym(Guid gym, CancellationToken ct)
    {
        Validation.Require(await db.GymProfiles.AnyAsync(x => x.Id == gym, ct), "That gym no longer exists.", 404);
        return gym;
    }

    private async Task<LoadSettingsView> Read(Guid gym, CancellationToken ct, string? unit)
    {
        var exercises = await catalog.All(ct);
        var rules = await LoadRuleReader.Read(db, [], ct, unit, gymProfileId: gym);
        var defaults = await db.EquipmentLoadDefaults.AsNoTracking().Where(x => x.GymProfileId == gym).ToDictionaryAsync(x => x.Equipment, ct);
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
        return new LoadSettingsView(equipment, gym);
    }

    /// Both fields empty restores the app default for the group.
    public async Task<LoadSettingsView> SaveEquipment(string group, LoadRuleInput input, CancellationToken ct, Guid? gymProfileId = null)
    {
        Validation.Require(EquipmentGroups.IsKnown(group), "That equipment type has no weight settings.", 404);
        Validation.Require(gymProfileId is null || input.GymProfileId is null || gymProfileId == input.GymProfileId,
            "These weight settings are for another gym.", 409);
        var (step, loadsJson) = LoadRuleValidation.Normalize(input.LoadStepKg, input.AvailableLoadsKg);
        var unit = await LoadRuleReader.ReadingUnit(db, input.Unit, ct);
        Guid gym;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            gym = gymProfileId is { } target ? await RequireGym(target, ct) : await GymProfiles.ForWeightSettingsSave(db, input.GymProfileId, ct);
            var row = await db.EquipmentLoadDefaults.SingleOrDefaultAsync(x => x.GymProfileId == gym && x.Equipment == group, ct);
            Validation.Require(input.Revision == (row?.Revision ?? 0),
                "These weight settings changed elsewhere. Reload them before saving again.", 409);
            if (row is null)
            {
                row = new EquipmentLoadDefault { UserId = db.CurrentUser!.Value, GymProfileId = gym, Equipment = group };
                db.EquipmentLoadDefaults.Add(row);
            }
            row.LoadStepKg = step;
            row.LoadStepUnit = unit;
            row.AvailableLoadsJson = loadsJson;
            row.Revision++;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        return await Read(gym, ct, unit);
    }
}
