using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// What the app is suggesting for one exercise and why. Every field is optional because a
/// first session has nothing to go on, and an empty suggestion is shown as empty.
public record ProgressionView(double? SuggestedKg, int TargetReps, string Reason, double? LastE1rmKg, double? TrendE1rmKg, double StepKg);

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

    /// The load step for each exercise, defaulted from equipment for catalog rows and from the
    /// barbell step for anything the catalog never matched.
    public async Task<Dictionary<Guid, double>> Steps(IEnumerable<Guid?> exerciseIds, CancellationToken ct)
    {
        var ids = exerciseIds.Where(id => id != null).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0) return [];
        return await db.Exercises.AsNoTracking().Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.LoadStepKg, ct);
    }

    /// Folds a finished session's completed sets into the running estimate. Exercises whose
    /// sets cannot support an estimate are left untouched rather than reset.
    public async Task Record(List<(Guid? ExerciseId, string Name, List<PreviousSet> Sets)> performed, CancellationToken ct)
    {
        var user = db.CurrentUser!.Value;
        foreach (var (exerciseId, name, sets) in performed)
        {
            if (Progression.SessionE1rm(sets) is not { } estimate) continue;
            var (key, nameKey) = Key(exerciseId, name);
            var row = await db.Progress.SingleOrDefaultAsync(p => p.ExerciseId == key && p.NameKey == nameKey, ct);
            var current = row == null ? null : new ProgressionState(row.TrendE1rmKg, row.LastE1rmKg, row.Stalls);
            var next = Progression.Advance(current, estimate);
            if (row == null)
            {
                row = new ExerciseProgress { UserId = user, ExerciseId = key, NameKey = nameKey };
                db.Progress.Add(row);
            }
            row.TrendE1rmKg = next.TrendE1rmKg; row.LastE1rmKg = next.LastE1rmKg; row.Stalls = next.Stalls;
            row.UpdatedAt = DateTime.UtcNow; row.Revision++;
        }
    }
}
