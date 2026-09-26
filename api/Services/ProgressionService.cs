using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// What the app is suggesting for one exercise and why. Every field is optional because a
/// first session has nothing to go on, and an empty suggestion is shown as empty.
public record ProgressionView(double? SuggestedKg, int TargetReps, string Reason, double? LastE1rmKg, double? TrendE1rmKg, double StepKg,
    string Mode = ProgressionModes.Normal, long? NutritionContextRevision = null);

public record ExerciseLoadInfo(string LoadModel, double StepKg, IReadOnlyList<double>? AvailableLoadsKg = null);

/// Reads and writes the running strength estimate. Suggestions are derived by Progression;
/// this class only supplies it with history and stores what comes back.
public sealed class ProgressionService(AppDb db)
{
    /// The identity a progression row is keyed by. It mirrors how WorkoutService.Previous
    /// matches history, so a suggestion always describes the sets it was built from.
    public static (Guid ExerciseId, string NameKey) Key(Guid? exerciseId, string name)
        => exerciseId is { } id ? (id, "") : (Guid.Empty, CatalogService.Normalize(name));

    public async Task<Dictionary<(Guid, string), ProgressionState>> States(IEnumerable<(Guid, string)> keys, CancellationToken ct)
    {
        var wanted = keys.Distinct().ToList();
        if (wanted.Count == 0) return [];
        var ids = wanted.Select(k => k.Item1).Distinct().ToList();
        var rows = await db.Progress.AsNoTracking().Where(p => ids.Contains(p.ExerciseId)).ToListAsync(ct);
        return rows.Where(r => wanted.Contains((r.ExerciseId, r.NameKey)))
            .ToDictionary(r => (r.ExerciseId, r.NameKey), r => new ProgressionState(r.TrendE1rmKg, r.LastE1rmKg, r.Stalls));
    }

    /// Account overrides take precedence over the seed-owned or custom exercise default.
    /// Call LoadInfo when selecting loads so uneven lists are also respected.
    public async Task<Dictionary<Guid, double>> Steps(IEnumerable<Guid?> exerciseIds, CancellationToken ct)
    {
        var ids = exerciseIds.Where(id => id != null).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0) return [];
        var output = await db.Exercises.AsNoTracking().Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.LoadStepKg, ct);
        var custom = await db.CustomExercises.AsNoTracking().Where(x => ids.Contains(x.Id)).ToListAsync(ct);
        foreach (var row in custom) output[row.Id] = row.LoadStepKg;
        var settings = await db.ExerciseLoadSettings.AsNoTracking().Where(x => ids.Contains(x.Id)).ToListAsync(ct);
        foreach (var row in settings)
            if (output.ContainsKey(row.Id) && row.LoadStepKg is { } step) output[row.Id] = step;
        return output;
    }

    public async Task<Dictionary<Guid, ExerciseLoadInfo>> LoadInfo(IEnumerable<Guid?> exerciseIds, CancellationToken ct)
    {
        var ids = exerciseIds.Where(id => id != null).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0) return [];
        var output = await db.Exercises.AsNoTracking().Where(x => ids.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => new ExerciseLoadInfo(x.LoadModel, x.LoadStepKg), ct);
        var custom = await db.CustomExercises.AsNoTracking().Where(x => ids.Contains(x.Id)).ToListAsync(ct);
        foreach (var row in custom) output[row.Id] = new ExerciseLoadInfo(row.LoadModel, row.LoadStepKg);
        var settings = await db.ExerciseLoadSettings.AsNoTracking().Where(x => ids.Contains(x.Id)).ToListAsync(ct);
        foreach (var row in settings)
            if (output.TryGetValue(row.Id, out var info))
                output[row.Id] = info with
                {
                    StepKg = row.LoadStepKg ?? info.StepKg,
                    AvailableLoadsKg = row.AvailableLoadsJson is { } json ? Json.Read<List<double>>(json) : null
                };
        return output;
    }

    /// Folds a finished session's completed sets into the running estimate. Exercises whose
    /// sets cannot support an estimate are left untouched rather than reset.
    public async Task Record(List<(Guid? ExerciseId, string Name, List<PreviousSet> Sets)> performed, CancellationToken ct)
    {
        var user = db.CurrentUser!.Value;
        var candidates = performed.Select(item =>
        {
            var estimate = Progression.SessionE1rm(item.Sets);
            var (key, nameKey) = Key(item.ExerciseId, item.Name);
            return (item, estimate, key, nameKey);
        }).Where(x => x.estimate is not null).ToList();
        if (candidates.Count == 0) return;
        var ids = candidates.Select(x => x.key).Distinct().ToList();
        var names = candidates.Select(x => x.nameKey).Distinct(StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal);
        var existing = await db.Progress.Where(p => ids.Contains(p.ExerciseId) && names.Contains(p.NameKey)).ToListAsync(ct);
        var byKey = existing.ToDictionary(row => (row.ExerciseId, row.NameKey));
        foreach (var candidate in candidates)
        {
            var estimate = candidate.estimate!.Value;
            var key = candidate.key; var nameKey = candidate.nameKey;
            byKey.TryGetValue((key, nameKey), out var row);
            var current = row == null ? null : new ProgressionState(row.TrendE1rmKg, row.LastE1rmKg, row.Stalls);
            var next = Progression.Advance(current, estimate);
            if (row == null)
            {
                row = new ExerciseProgress { UserId = user, ExerciseId = key, NameKey = nameKey };
                db.Progress.Add(row);
                byKey[(key, nameKey)] = row;
            }
            row.TrendE1rmKg = next.TrendE1rmKg; row.LastE1rmKg = next.LastE1rmKg; row.Stalls = next.Stalls;
            row.UpdatedAt = DateTime.UtcNow; row.Revision++;
        }
    }
}
