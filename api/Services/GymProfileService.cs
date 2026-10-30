using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record GymProfileView(Guid Id, string Name, List<string> MissingEquipment, Dictionary<string, string> ExerciseOverrides,
    int Revision, bool Active);
public record GymProfileSummary(Guid Id, string Name);
/// MissingLabels names each missing item, so a warning can say what is missing without the full list.
public record GymLaunchView(GymProfileView Active, List<GymProfileSummary> Profiles, Dictionary<string, string> MissingLabels);
public record GymsView(Guid ActiveId, List<GymProfileView> Profiles, IReadOnlyList<GymEquipmentItem> Equipment);

/// CopyFrom starts the new gym with another gym's missing equipment, exercise choices and weights.
public record GymProfileCreateInput(string Name, Guid? CopyFrom = null);
public record GymProfileUpdateInput(string Name, List<string>? MissingEquipment, Dictionary<string, string>? ExerciseOverrides, int Revision);

/// Gym profiles say what each place lacks and which weights its equipment offers. The active one
/// decides warnings, load rules and the gym a new workout records. Switching is refused while a
/// workout is open, so a session's suggestions and its recorded gym never disagree.
public sealed class GymProfileService(AppDb db)
{
    public const string DefaultName = "My gym";

    public async Task<GymsView> Get(CancellationToken ct)
    {
        if (await GymProfiles.ActiveId(db, ct) is null)
        {
            await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
            await GymProfiles.EnsureActive(db, ct);
            await gate.Commit(ct);
        }
        return await View(ct);
    }

    public async Task<GymsView> Create(GymProfileCreateInput input, CancellationToken ct)
    {
        var name = CleanName(input.Name);
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            await GymProfiles.EnsureActive(db, ct);
            var existing = await db.GymProfiles.ToListAsync(ct);
            Validation.Require(existing.Count < GymProfileLimits.MaxProfiles, $"You can keep up to {GymProfileLimits.MaxProfiles} gyms.");
            RequireUniqueName(existing, name, null);
            var profile = new GymProfile { UserId = db.CurrentUser!.Value, Name = name, Revision = 1 };
            if (input.CopyFrom is { } sourceId)
            {
                var source = existing.SingleOrDefault(x => x.Id == sourceId);
                Validation.Require(source is not null, "That gym no longer exists.", 404);
                profile.MissingEquipmentJson = source!.MissingEquipmentJson;
                profile.ExerciseOverridesJson = source.ExerciseOverridesJson;
                await CopyLoadRules(sourceId, profile.Id, ct);
            }
            db.GymProfiles.Add(profile);
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        return await View(ct);
    }

    public async Task<GymsView> Update(Guid id, GymProfileUpdateInput input, CancellationToken ct)
    {
        var name = CleanName(input.Name);
        var missing = CleanMissing(input.MissingEquipment);
        var overrides = CleanOverrides(input.ExerciseOverrides);
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var existing = await db.GymProfiles.ToListAsync(ct);
            var profile = existing.SingleOrDefault(x => x.Id == id);
            Validation.Require(profile is not null, "That gym no longer exists.", 404);
            Validation.Require(profile!.Revision == input.Revision, "This gym changed elsewhere. Reload it before saving again.", 409);
            RequireUniqueName(existing, name, id);
            profile.Name = name;
            profile.MissingEquipmentJson = Json.Write(missing);
            profile.ExerciseOverridesJson = Json.Write(overrides);
            profile.Revision++;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        return await View(ct);
    }

    public async Task<GymsView> Activate(Guid id, CancellationToken ct)
    {
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            Validation.Require(await db.GymProfiles.AnyAsync(x => x.Id == id, ct), "That gym no longer exists.", 404);
            var user = await db.Users.SingleAsync(x => x.Id == db.CurrentUser, ct);
            if (user.ActiveGymProfileId != id)
            {
                Validation.Require(!await db.Workouts.AnyAsync(w => w.Active, ct),
                    "Finish or discard your workout before switching gyms.", 409);
                user.ActiveGymProfileId = id;
                await db.SaveChangesAsync(ct);
            }
            await gate.Commit(ct);
        }
        return await View(ct);
    }

    /// Its weights go with it. Workouts done there stay in history but no longer name a gym.
    public async Task<GymsView> Delete(Guid id, CancellationToken ct)
    {
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var profile = await db.GymProfiles.SingleOrDefaultAsync(x => x.Id == id, ct);
            Validation.Require(profile is not null, "That gym no longer exists.", 404);
            Validation.Require(await GymProfiles.ActiveId(db, ct) != id, "Switch to another gym before deleting this one.", 409);
            await db.Workouts.Where(w => w.GymProfileId == id)
                .ExecuteUpdateAsync(update => update.SetProperty(w => w.GymProfileId, (Guid?)null), ct);
            db.GymProfiles.Remove(profile!);
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        return await View(ct);
    }

    private async Task<GymsView> View(CancellationToken ct)
    {
        var activeId = await GymProfiles.ActiveId(db, ct) ?? Guid.Empty;
        var profiles = await db.GymProfiles.AsNoTracking().OrderBy(x => x.CreatedAt).ThenBy(x => x.Name).ToListAsync(ct);
        return new GymsView(activeId, [.. profiles.Select(x => GymProfiles.ToView(x, x.Id == activeId))], GymEquipment.Items);
    }

    private async Task CopyLoadRules(Guid sourceId, Guid targetId, CancellationToken ct)
    {
        var exerciseRules = await db.ExerciseLoadSettings.AsNoTracking().Where(x => x.GymProfileId == sourceId).ToListAsync(ct);
        db.ExerciseLoadSettings.AddRange(exerciseRules.Select(x => new ExerciseLoadSetting
        {
            UserId = x.UserId, Id = x.Id, GymProfileId = targetId, LoadStepKg = x.LoadStepKg, LoadStepUnit = x.LoadStepUnit,
            AvailableLoadsJson = x.AvailableLoadsJson, Revision = 1
        }));
        var equipmentRules = await db.EquipmentLoadDefaults.AsNoTracking().Where(x => x.GymProfileId == sourceId).ToListAsync(ct);
        db.EquipmentLoadDefaults.AddRange(equipmentRules.Select(x => new EquipmentLoadDefault
        {
            UserId = x.UserId, GymProfileId = targetId, Equipment = x.Equipment, LoadStepKg = x.LoadStepKg,
            LoadStepUnit = x.LoadStepUnit, AvailableLoadsJson = x.AvailableLoadsJson, Revision = 1
        }));
    }

    private static string CleanName(string? name)
    {
        Validation.Name(name, "Gym name", GymProfileLimits.NameLength);
        return string.Join(' ', name!.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    private static void RequireUniqueName(IEnumerable<GymProfile> existing, string name, Guid? except)
        => Validation.Require(!existing.Any(x => x.Id != except && string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase)),
            "You already have a gym with that name.");

    private static List<string> CleanMissing(List<string>? keys)
    {
        var missing = (keys ?? []).Distinct(StringComparer.Ordinal).ToList();
        Validation.Require(missing.All(GymEquipment.IsKnown), "That equipment is not on the list.");
        return [.. missing.OrderBy(key => key, StringComparer.Ordinal)];
    }

    private static Dictionary<string, string> CleanOverrides(Dictionary<string, string>? overrides)
    {
        var output = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (key, value) in overrides ?? [])
        {
            Validation.Require(Guid.TryParse(key, out var id) && GymExerciseOverrides.IsValid(value), "That exercise choice is not valid.");
            output[id.ToString()] = value;
        }
        Validation.Require(output.Count <= 2000, "A gym can mark at most 2000 exercises.");
        return output;
    }
}

/// Reads shared by every service that needs the account's gym.
public static class GymProfiles
{
    public static async Task<Guid?> ActiveId(AppDb db, CancellationToken ct)
    {
        if (db.CurrentUser is null) return null;
        var id = await db.Users.AsNoTracking().Where(x => x.Id == db.CurrentUser).Select(x => x.ActiveGymProfileId).SingleOrDefaultAsync(ct);
        return id is { } active && await db.GymProfiles.AnyAsync(x => x.Id == active, ct) ? active : null;
    }

    /// The caller holds the mutation lock. An account without a usable active gym gets its oldest
    /// gym back, or a first one made for it.
    public static async Task<Guid> EnsureActive(AppDb db, CancellationToken ct)
    {
        if (await ActiveId(db, ct) is { } active) return active;
        var user = await db.Users.SingleAsync(x => x.Id == db.CurrentUser, ct);
        var profile = await db.GymProfiles.OrderBy(x => x.CreatedAt).FirstOrDefaultAsync(ct);
        if (profile is null)
        {
            profile = new GymProfile { UserId = user.Id, Name = GymProfileService.DefaultName, Revision = 1 };
            db.GymProfiles.Add(profile);
        }
        user.ActiveGymProfileId = profile.Id;
        await db.SaveChangesAsync(ct);
        return profile.Id;
    }

    /// The active gym in full, for warnings everywhere, and the others by name, for switching.
    /// Null before the account's first gym exists: nothing is missing then.
    public static async Task<GymLaunchView?> Launch(AppDb db, CancellationToken ct)
    {
        if (await ActiveId(db, ct) is not { } activeId) return null;
        var profiles = await db.GymProfiles.AsNoTracking().OrderBy(x => x.CreatedAt).ThenBy(x => x.Name).ToListAsync(ct);
        var active = ToView(profiles.Single(x => x.Id == activeId), true);
        var missing = active.MissingEquipment.ToHashSet(StringComparer.Ordinal);
        return new GymLaunchView(active, [.. profiles.Select(x => new GymProfileSummary(x.Id, x.Name))],
            GymEquipment.Items.Where(item => missing.Contains(item.Key)).ToDictionary(item => item.Key, GymEquipment.DisplayName));
    }

    public static GymProfileView ToView(GymProfile profile, bool active)
        => new(profile.Id, profile.Name, Read<List<string>>(profile.MissingEquipmentJson) ?? [],
            Read<Dictionary<string, string>>(profile.ExerciseOverridesJson) ?? [], profile.Revision, active);

    private static T? Read<T>(string json) where T : class
    {
        try { return string.IsNullOrWhiteSpace(json) ? null : Json.Read<T>(json); }
        catch { return null; }
    }
}
