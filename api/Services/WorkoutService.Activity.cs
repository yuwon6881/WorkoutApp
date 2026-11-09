using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class WorkoutService
{
    public async Task<List<WorkoutActivityItem>> Activity(DateOnly? from, DateOnly? to, string? timeZone, CancellationToken ct)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(timeZone), "A valid time zone is required.", 400);
        if (!TimeZoneInfo.TryFindSystemTimeZoneById(timeZone!.Trim(), out var zone))
            throw new DomainException("Unknown or unsupported time zone.", 400);

        var todayLocal = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        var start = from ?? todayLocal.AddDays(-30);
        var end = to ?? todayLocal;
        Validation.Require(start <= end && end.DayNumber - start.DayNumber <= 366, "Choose a date range of one year or less.");

        var startUtc = start.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(-1);
        var endUtc = end.AddDays(2).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var history = await db.ResourceGenerations.AsNoTracking().Select(x => x.History).SingleOrDefaultAsync(ct);
        var cacheKey = $"activity:{db.CurrentUser}:{history}:{start:yyyy-MM-dd}:{end:yyyy-MM-dd}:{zone.Id}";
        List<ActivityEntry>? completed = null;
        var canCache = readCache is not null && db.Database.CurrentTransaction is null;
        if (canCache) readCache!.TryGetValue(cacheKey, out completed);
        if (completed is null)
        {
            var rows = await db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null &&
                w.FinishedAt >= startUtc && w.FinishedAt < endUtc).WithoutSnapshots().ToListAsync(ct);
            completed = await ActivityRows(rows, start, end, zone, ct);
            if (canCache) readCache!.Set(cacheKey, completed,
                new MemoryCacheEntryOptions { Size = 1, AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2) });
        }
        var active = await db.Workouts.AsNoTracking().Where(w => w.Active && w.FinishedAt == null &&
            w.StartedAt >= startUtc && w.StartedAt < endUtc).WithoutSnapshots().ToListAsync(ct);
        var live = await ActivityRows(active, start, end, zone, ct);
        return completed.Concat(live).OrderBy(x => x.Item.Date).ThenBy(x => x.Timestamp).Select(x => x.Item).ToList();
    }

    private sealed record ActivityEntry(WorkoutActivityItem Item, DateTime Timestamp);

    private async Task<List<ActivityEntry>> ActivityRows(List<WorkoutSession> rows, DateOnly start, DateOnly end,
        TimeZoneInfo zone, CancellationToken ct)
    {
        var completedIds = rows.Where(row => row.FinishedAt != null).Select(row => row.Id).ToList();
        var workingSets = completedIds.Count == 0 ? new Dictionary<Guid, int>() : await (from set in db.Sets.AsNoTracking()
            join exercise in db.SessionExercises.AsNoTracking() on set.SessionExerciseId equals exercise.Id
            where completedIds.Contains(exercise.SessionId) && set.Done && !set.Warmup
            group set by exercise.SessionId into sessionSets
            select new { Id = sessionSets.Key, Count = sessionSets.Count() })
            .ToDictionaryAsync(row => row.Id, row => row.Count, ct);

        var items = new List<ActivityEntry>();
        foreach (var w in rows)
        {
            var isCompleted = w.FinishedAt != null;
            var timestamp = isCompleted ? w.FinishedAt!.Value : w.StartedAt;
            var localDateTime = TimeZoneInfo.ConvertTimeFromUtc(timestamp, zone);
            var localDate = DateOnly.FromDateTime(localDateTime);
            if (localDate < start || localDate > end) continue;

            var status = isCompleted ? "completed" : "in_progress";
            int? minutes = null;
            if (isCompleted)
            {
                var paused = w.PausedSeconds + (w.PausedAt is { } at
                    ? Math.Max(0, (long)Math.Round((timestamp - at).TotalSeconds)) : 0);
                minutes = Math.Max(1, (int)Math.Round(Math.Max(0, (timestamp - w.StartedAt).TotalSeconds - paused) / 60));
            }
            items.Add(new ActivityEntry(new WorkoutActivityItem(w.Id, w.Name, status, localDate,
                isCompleted ? workingSets.GetValueOrDefault(w.Id) : null, minutes), timestamp));
        }

        return items;
    }

}
