using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public static class HistoryReadService
{
    public static async Task<object> Get(AppDb db, DateTime? beforeAt, Guid? beforeId, int size, CancellationToken ct)
    {
        Validation.Require(size is > 0 and <= 100 && (beforeAt == null) == (beforeId == null), "Invalid history cursor.");
        var query = db.Workouts.AsNoTracking().Where(x => x.FinishedAt != null);
        var total = await query.CountAsync(ct);
        if (beforeAt is { } at && beforeId is { } id)
            query = query.Where(x => x.FinishedAt < at || x.FinishedAt == at && x.Id.CompareTo(id) < 0);
        var rows = await query.OrderByDescending(x => x.FinishedAt).ThenByDescending(x => x.Id).Take(size + 1).ToListAsync(ct);
        var selected = rows.Take(size).ToList();
        var ids = selected.Select(x => x.Id).ToList();
        var totals = await (from set in db.Sets.AsNoTracking()
            join exercise in db.SessionExercises.AsNoTracking() on set.SessionExerciseId equals exercise.Id
            where ids.Contains(exercise.SessionId) && set.Done
            group new { set, exercise } by exercise.SessionId into groupRows
            select new
            {
                Id = groupRows.Key,
                Working = groupRows.Count(x => !x.set.Warmup), Warmup = groupRows.Count(x => x.set.Warmup),
                ExternalCount = groupRows.Count(x => !x.set.Warmup && x.exercise.LoadModel == LoadModels.External && x.set.SystemLoadKg == null && x.set.WeightKg != null && x.set.Reps != null),
                SystemCount = groupRows.Count(x => !x.set.Warmup && x.set.SystemLoadKg != null && x.set.Reps != null),
                Volume = groupRows.Where(x => !x.set.Warmup && x.exercise.LoadModel == LoadModels.External && x.set.SystemLoadKg == null && x.set.WeightKg != null)
                    .Sum(x => x.set.WeightKg * x.set.Reps),
                SystemVolume = groupRows.Where(x => !x.set.Warmup && x.set.SystemLoadKg != null).Sum(x => x.set.SystemLoadKg * x.set.Reps)
            }).ToDictionaryAsync(x => x.Id, ct);
        var prs = await WorkoutPrReadService.Get(db, selected, ct);
        var sessions = selected.Select(row =>
        {
            var value = totals.GetValueOrDefault(row.Id);
            return new SessionView(row.Id, row.TemplateId, row.ProgramId, row.Name, row.Note, false, row.StartedAt, row.FinishedAt,
                row.Revision, [], value?.ExternalCount > 0 ? value.Volume : null, value?.Working ?? 0, value?.Warmup ?? 0,
                SystemVolumeKg: value?.SystemCount > 0 ? value.SystemVolume : null, PausedAt: row.PausedAt, PausedSeconds: row.PausedSeconds, PrCount: prs.SessionPrCounts.GetValueOrDefault(row.Id));
        }).ToList();
        var last = selected.LastOrDefault();
        var more = rows.Count > size;
        return new { total, sessions, nextBeforeAt = more ? last?.FinishedAt : null, nextBeforeId = more ? last?.Id : null, summaryOnly = true };
    }
}
