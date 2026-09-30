using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record LoadRuleInput(double? LoadStepKg, List<double>? AvailableLoadsKg, Guid? StackId, int Revision);
public record LoadStackInput(string Name, double? LoadStepKg, List<double>? AvailableLoadsKg, int Revision);

public record EquipmentLoadView(string Group, double AppDefaultStepKg, double? OwnStepKg, List<double>? OwnAvailableLoadsKg,
    Guid? StackId, double StepKg, List<double>? AvailableLoadsKg, string Source, string? StackName, int Revision,
    int ExerciseCount);
public record LoadStackView(Guid Id, string Name, double? LoadStepKg, List<double>? AvailableLoadsKg, int Revision,
    int ExerciseCount, List<string> EquipmentGroups);
public record LoadOverrideView(Guid ExerciseId, string Name, string Equipment, double? OwnStepKg,
    List<double>? OwnAvailableLoadsKg, Guid? StackId, string? StackName, int Revision);
public record LoadSettingsView(List<EquipmentLoadView> Equipment, List<LoadStackView> Stacks, List<LoadOverrideView> Overrides);

/// Account-wide load rules: one per equipment group, and the named stacks exercises and groups can
/// share. Per-exercise rules stay in ExerciseLoadSettingsService.
public sealed class LoadSettingsService(AppDb db, CatalogService catalog)
{
    public async Task<LoadSettingsView> Get(CancellationToken ct)
    {
        var exercises = await catalog.All(ct);
        var rules = await LoadRuleReader.Read(db, null, ct);
        var defaults = await db.EquipmentLoadDefaults.AsNoTracking().ToDictionaryAsync(x => x.Equipment, ct);
        var stacks = await db.LoadStacks.AsNoTracking().OrderBy(x => x.Name).ToListAsync(ct);
        var settings = await db.ExerciseLoadSettings.AsNoTracking()
            .Where(x => x.LoadStepKg != null || x.AvailableLoadsJson != null || x.StackId != null).ToListAsync(ct);
        var names = exercises.ToDictionary(x => x.Id);
        var groupSizes = exercises.Select(x => EquipmentGroups.For(x.Equipment, x.LoadModel))
            .Where(group => group is not null).GroupBy(group => group!).ToDictionary(g => g.Key, g => g.Count());

        var equipment = EquipmentGroups.All.Select(group =>
        {
            defaults.TryGetValue(group, out var row);
            var resolved = rules.ResolveGroup(group);
            return new EquipmentLoadView(group, EquipmentGroups.AppDefaultStep(group), row?.LoadStepKg,
                LoadRuleReader.Loads(row?.AvailableLoadsJson), row?.StackId, resolved.StepKg, resolved.AvailableLoadsKg?.ToList(),
                resolved.Source, resolved.StackName, row?.Revision ?? 0, groupSizes.GetValueOrDefault(group));
        }).ToList();
        var stackViews = stacks.Select(stack => new LoadStackView(stack.Id, stack.Name, stack.LoadStepKg,
            LoadRuleReader.Loads(stack.AvailableLoadsJson), stack.Revision,
            settings.Count(x => x.StackId == stack.Id && names.ContainsKey(x.Id)),
            defaults.Values.Where(x => x.StackId == stack.Id && EquipmentGroups.IsKnown(x.Equipment)).Select(x => x.Equipment).Order().ToList())).ToList();
        var stackNames = stacks.ToDictionary(x => x.Id, x => x.Name);
        var overrides = settings.Where(x => names.ContainsKey(x.Id)).Select(x => new LoadOverrideView(x.Id, names[x.Id].Name,
                names[x.Id].Equipment, x.LoadStepKg, LoadRuleReader.Loads(x.AvailableLoadsJson), x.StackId,
                x.StackId is { } id ? stackNames.GetValueOrDefault(id) : null, x.Revision))
            .OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ToList();
        return new LoadSettingsView(equipment, stackViews, overrides);
    }

    /// All fields empty restores the app default for the group.
    public async Task<LoadSettingsView> SaveEquipment(string group, LoadRuleInput input, CancellationToken ct)
    {
        Validation.Require(EquipmentGroups.IsKnown(group), "That equipment type has no weight settings.", 404);
        var (step, loadsJson, stackId) = LoadRuleValidation.Normalize(input.LoadStepKg, input.AvailableLoadsKg, input.StackId);
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            await LoadRuleValidation.RequireStack(db, stackId, ct);
            var row = await db.EquipmentLoadDefaults.SingleOrDefaultAsync(x => x.Equipment == group, ct);
            Validation.Require(input.Revision == (row?.Revision ?? 0),
                "These weight settings changed elsewhere. Reload them before saving again.", 409);
            if (row is null)
            {
                row = new EquipmentLoadDefault { UserId = db.CurrentUser!.Value, Equipment = group };
                db.EquipmentLoadDefaults.Add(row);
            }
            row.LoadStepKg = step;
            row.AvailableLoadsJson = loadsJson;
            row.StackId = stackId;
            row.Revision++;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        return await Get(ct);
    }

    public async Task<LoadSettingsView> SaveStack(Guid? id, LoadStackInput input, CancellationToken ct)
    {
        var name = (input.Name ?? "").Trim();
        Validation.Text(name, 60, "Stack name");
        Validation.Require(name.Length > 0, "Name the weight stack.");
        Validation.Require((input.LoadStepKg is null) != (input.AvailableLoadsKg is null),
            "Give the stack either a fixed increment or its available weights.");
        if (input.LoadStepKg is { } step) Validation.Number(step, 0.01, 50, "Weight increment");
        var loadsJson = input.AvailableLoadsKg is { } loads ? Json.Write(LoadRuleValidation.Weights(loads)) : null;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            Validation.Require(!await db.LoadStacks.AnyAsync(x => x.Name == name && x.Id != id, ct),
                "Another weight stack already has that name.", 409);
            LoadStack row;
            if (id is { } existing)
            {
                row = await db.LoadStacks.SingleOrDefaultAsync(x => x.Id == existing, ct)
                    ?? throw new DomainException("That weight stack no longer exists.", 404);
                Validation.Require(input.Revision == row.Revision,
                    "This weight stack changed elsewhere. Reload it before saving again.", 409);
            }
            else
            {
                row = new LoadStack { UserId = db.CurrentUser!.Value };
                db.LoadStacks.Add(row);
            }
            row.Name = name;
            row.LoadStepKg = input.LoadStepKg;
            row.AvailableLoadsJson = loadsJson;
            row.Revision++;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        return await Get(ct);
    }

    /// Everything that used the stack goes back to the rule it would otherwise inherit.
    public async Task<LoadSettingsView> DeleteStack(Guid id, CancellationToken ct)
    {
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var row = await db.LoadStacks.SingleOrDefaultAsync(x => x.Id == id, ct);
            Validation.Require(row is not null, "That weight stack no longer exists.", 404);
            foreach (var setting in await db.ExerciseLoadSettings.Where(x => x.StackId == id).ToListAsync(ct))
            {
                setting.StackId = null;
                setting.Revision++;
            }
            foreach (var rule in await db.EquipmentLoadDefaults.Where(x => x.StackId == id).ToListAsync(ct))
            {
                rule.StackId = null;
                rule.Revision++;
            }
            db.LoadStacks.Remove(row!);
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        return await Get(ct);
    }
}
