using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class WorkoutService
{
    /// Return up to thirty completed exposures per
    /// working-set ordinal, matching catalog id or normalized unresolved name. Warm-ups are
    /// excluded before legacy ordinals are assigned.
    public async Task<Dictionary<int, List<SetExposure>>> PreviousExposures(Guid? exerciseId, string name, CancellationToken ct)
    {
        var batch = await PreviousExposuresBatch([(exerciseId, name)], ct);
        var key = (exerciseId, exerciseId is null ? CatalogService.Normalize(name) : "");
        return batch.GetValueOrDefault(key) ?? [];
    }

    /// Loads all planned exercise histories with one bounded set of database reads. Catalog IDs
    /// use a per-key top-30 query; unresolved names retain the legacy recent-60 matching rule.
    private async Task<Dictionary<(Guid? ExerciseId, string NameKey), Dictionary<int, List<SetExposure>>>> PreviousExposuresBatch(
        IEnumerable<(Guid? ExerciseId, string Name)> requested, CancellationToken ct)
    {
        var requests = requested.Select(x => (x.ExerciseId, NameKey: CatalogService.Normalize(x.Name))).Distinct().ToList();
        if (requests.Count == 0) return [];
        var ids = requests.Where(x => x.ExerciseId is not null).Select(x => x.ExerciseId!.Value).Distinct().ToList();
        var names = requests.Where(x => x.ExerciseId is null).Select(x => x.NameKey).ToHashSet(StringComparer.Ordinal);
        var query = db.SessionExercises.AsNoTracking().Join(db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null),
            e => e.SessionId, w => w.Id, (e, w) => new { e.Id, e.SessionId, e.ExerciseId, e.NameSnapshot, e.PrescriptionJson, w.FinishedAt });
        var matches = new List<PreviousExposureMatch>();
        if (ids.Count > 0)
        {
            // Keep the shared read bounded for long histories. A sparse exercise gets a targeted
            // top-30 fill only when it did not appear in the recent window; ordinary starts stay
            // at one query without relying on provider-specific window-function translation.
            var window = Math.Min(4800, Math.Max(120, ids.Count * 120));
            var catalogMatches = await query.Where(x => x.ExerciseId != null && ids.Contains(x.ExerciseId.Value))
                .OrderByDescending(x => x.FinishedAt).Take(window).ToListAsync(ct);
            foreach (var id in ids)
            {
                var selected = catalogMatches.Where(x => x.ExerciseId == id).Take(30).ToList();
                if (selected.Count < 30)
                {
                    selected = await query.Where(x => x.ExerciseId == id).OrderByDescending(x => x.FinishedAt).Take(30).ToListAsync(ct);
                }
                matches.AddRange(selected.Select(x => new PreviousExposureMatch(x.Id, x.SessionId, x.ExerciseId, x.NameSnapshot, x.PrescriptionJson, x.FinishedAt)));
            }
        }
        if (names.Count > 0)
        {
            var unresolvedMatches = await query.Where(x => x.ExerciseId == null).OrderByDescending(x => x.FinishedAt)
                .Take(Math.Min(600, Math.Max(60, names.Count * 60))).ToListAsync(ct);
            matches.AddRange(unresolvedMatches.Where(x => names.Contains(CatalogService.Normalize(x.NameSnapshot)))
                .Select(x => new PreviousExposureMatch(x.Id, x.SessionId, x.ExerciseId, x.NameSnapshot, x.PrescriptionJson, x.FinishedAt)));
        }
        var matchIds = matches.Select(x => (Guid)x.Id).ToList();
        if (matchIds.Count == 0) return [];
        var sets = await db.Sets.AsNoTracking().Where(s => matchIds.Contains(s.SessionExerciseId) && s.Done && !s.Warmup)
            .OrderBy(s => s.Position).ToListAsync(ct);
        var output = new Dictionary<(Guid? ExerciseId, string NameKey), Dictionary<int, List<SetExposure>>>();
        foreach (var group in matches.GroupBy(x => x.ExerciseId is { } id ? (Guid?)(id) : null))
        {
            foreach (var match in group.OrderByDescending(x => x.FinishedAt))
            {
                var key = (match.ExerciseId, match.ExerciseId is null ? CatalogService.Normalize(match.NameSnapshot) : "");
                if (!output.TryGetValue(key, out var exposures)) { exposures = []; output[key] = exposures; }
                var legacyOrdinal = 0;
                var prescriptions = Json.Read<List<SetPrescription>>(match.PrescriptionJson);
                foreach (var set in sets.Where(s => s.SessionExerciseId == match.Id).OrderBy(s => s.Position))
                {
                    var ordinal = set.WorkingSetOrdinal ?? ++legacyOrdinal;
                    if (set.WorkingSetOrdinal is not null) legacyOrdinal = Math.Max(legacyOrdinal, ordinal);
                    var list = exposures.GetValueOrDefault(ordinal);
                    if (list is null) { list = []; exposures[ordinal] = list; }
                    if (list.Count >= 30 || list.Any(exposure => exposure.SessionId == match.SessionId)) continue;
                    var prescription = prescriptions.ElementAtOrDefault(set.Position);
                    var suggestion = ReadOptional<SetProgressionSuggestion>(set.SuggestionJson);
                    var open = prescription is not null && Progression.HasOpenReps(prescription.RepsText);
                    list.Add(new SetExposure(match.SessionId, match.FinishedAt!.Value, set.WeightKg, set.Reps, set.Rpe,
                        set.SystemLoadKg, set.ResistanceMode, set.Rir,
                        open ? null : prescription?.RepMin, open ? null : prescription?.RepMax,
                        prescription?.TargetRpe, prescription?.Rir, suggestion?.IsRepRangeTransition == true,
                        prescription is not null));
                }
            }
        }
        return output;
    }

    /// Compatibility helper used by exports and older callers: the newest completed working sets
    /// are returned in ordinal order.
    public async Task<List<CompletedSet>> Previous(Guid? exerciseId, string name, CancellationToken ct)
    {
        var histories = await PreviousExposures(exerciseId, name, ct);
        return histories.OrderBy(pair => pair.Key).SelectMany(pair => pair.Value.Take(1).Select(exposure => new CompletedSet
        {
            WeightKg = exposure.LoadKg, Reps = exposure.Reps, Rpe = exposure.Rpe, SystemLoadKg = exposure.SystemLoadKg,
            ResistanceMode = exposure.ResistanceMode, Done = true, Warmup = false, WorkingSetOrdinal = pair.Key
        })).ToList();
    }

    private sealed record PreviousExposureMatch(Guid Id, Guid SessionId, Guid? ExerciseId, string NameSnapshot,
        string PrescriptionJson, DateTime? FinishedAt);
}
