using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record MuscleBalanceRow(string Muscle, double Sets, double PrimarySets, double SecondarySets,
    int Sessions, DateOnly? LastTrainedDate);

public record MuscleBalanceView(string Range, DateOnly From, DateOnly To, double Weeks,
    int Sessions, double TotalSets, List<MuscleBalanceRow> Muscles,
    double UnattributedSets, List<string> UnattributedExamples);

public sealed class MuscleBalanceService(AppDb db, CatalogService catalog, IMemoryCache cache)
{
    public async Task<MuscleBalanceView> Balance(string? range, string? timeZone, CancellationToken ct)
    {
        var (rangeValue, days, weeks) = ParseRange(range);
        Validation.Require(!string.IsNullOrWhiteSpace(timeZone), "A valid time zone is required.", 400);
        if (!TimeZoneInfo.TryFindSystemTimeZoneById(timeZone!.Trim(), out var zone))
            throw new DomainException("Unknown or unsupported time zone.", 400);

        var todayLocal = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        var from = todayLocal.AddDays(-(days - 1));
        var to = todayLocal;
        var startUtc = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(-1);
        var endUtc = to.AddDays(2).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var userId = db.CurrentUser!.Value;

        var workoutCount = await db.Workouts.LongCountAsync(ct);
        var workoutRevision = await db.Workouts.Select(x => (int?)x.Revision).MaxAsync(ct) ?? 0;
        var exerciseCount = await db.SessionExercises.LongCountAsync(ct);
        var exerciseRevision = await db.SessionExercises.Select(x => (int?)x.Revision).MaxAsync(ct) ?? 0;
        var setCount = await db.Sets.LongCountAsync(ct);
        var setRevision = await db.Sets.Select(x => (int?)x.Revision).MaxAsync(ct) ?? 0;
        var customCount = await db.CustomExercises.LongCountAsync(ct);
        var customRevision = await db.CustomExercises.Select(x => (int?)x.Revision).MaxAsync(ct) ?? 0;
        var cacheKey = $"workout:muscle-balance:{userId:N}:{rangeValue}:{timeZone.Trim()}:{todayLocal:yyyy-MM-dd}:" +
            $"{workoutCount}:{workoutRevision}:{exerciseCount}:{exerciseRevision}:{setCount}:{setRevision}:{customCount}:{customRevision}";
        if (cache.TryGetValue<MuscleBalanceView>(cacheKey, out var cached) && cached is not null) return cached;

        // Fetch finished sessions with padded UTC bounds, then apply the user's local date window.
        var candidateSessions = await db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null &&
            w.FinishedAt >= startUtc && w.FinishedAt < endUtc).ToListAsync(ct);
        var sessions = candidateSessions.Where(session =>
        {
            var localDate = LocalDate(session.FinishedAt!.Value, zone);
            return localDate >= from && localDate <= to;
        }).ToList();

        var sessionIds = sessions.Select(session => session.Id).ToList();
        var exercises = sessionIds.Count == 0
            ? []
            : await db.SessionExercises.AsNoTracking().Where(exercise => sessionIds.Contains(exercise.SessionId)).ToListAsync(ct);
        var exerciseIds = exercises.Select(exercise => exercise.Id).ToList();
        var sets = exerciseIds.Count == 0
            ? []
            : await db.Sets.AsNoTracking().Where(set => exerciseIds.Contains(set.SessionExerciseId) && set.Done && !set.Warmup)
                .ToListAsync(ct);
        var profiles = await catalog.MuscleProfilesFor(exercises.Where(exercise => exercise.ExerciseId != null)
            .Select(exercise => exercise.ExerciseId!.Value), ct);
        var exerciseById = exercises.ToDictionary(exercise => exercise.Id);
        var sessionById = sessions.ToDictionary(session => session.Id);
        var accumulators = MuscleRegions.All.ToDictionary(region => region, _ => new MuscleAccumulator(), StringComparer.Ordinal);
        var unattributedExamples = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var unattributedSets = 0;

        foreach (var set in sets)
        {
            var exercise = exerciseById[set.SessionExerciseId];
            profiles.TryGetValue(exercise.ExerciseId ?? Guid.Empty, out var profile);
            var hasProfile = exercise.ExerciseId is not null && profiles.ContainsKey(exercise.ExerciseId.Value);
            var credits = MuscleAttribution.For(exercise.NameSnapshot, hasProfile ? profile.Primary : null,
                hasProfile ? profile.Secondary : null);
            if (credits.Count == 0)
            {
                unattributedSets++;
                if (!string.IsNullOrWhiteSpace(exercise.NameSnapshot)) unattributedExamples.Add(exercise.NameSnapshot.Trim());
                continue;
            }

            var primaryRegions = MuscleAttribution.PrimaryFor(exercise.NameSnapshot, hasProfile ? profile.Primary : null)
                .Select(credit => credit.Region).ToHashSet(StringComparer.Ordinal);
            var session = sessionById[exercise.SessionId];
            var trainedDate = LocalDate(session.FinishedAt!.Value, zone);
            foreach (var credit in credits)
            {
                var accumulator = accumulators[credit.Region];
                accumulator.Sets += credit.Weight;
                if (primaryRegions.Contains(credit.Region)) accumulator.PrimarySets += credit.Weight;
                else accumulator.SecondarySets += credit.Weight;
                accumulator.Sessions.Add(session.Id);
                if (accumulator.LastTrainedDate is null || trainedDate > accumulator.LastTrainedDate)
                    accumulator.LastTrainedDate = trainedDate;
            }
        }

        var muscles = MuscleRegions.All.Select(region =>
        {
            var item = accumulators[region];
            return new MuscleBalanceRow(region, item.Sets, item.PrimarySets, item.SecondarySets,
                item.Sessions.Count, item.LastTrainedDate);
        }).ToList();
        var result = new MuscleBalanceView(rangeValue, from, to, weeks, sessions.Count, sets.Count,
            muscles, unattributedSets, unattributedExamples.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).Take(5).ToList());
        cache.Set(cacheKey, result, new MemoryCacheEntryOptions
        {
            Size = 1,
            AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30)
        });
        return result;
    }

    private static (string Range, int Days, double Weeks) ParseRange(string? range)
    {
        var value = string.IsNullOrWhiteSpace(range) ? "1w" : range.Trim();
        return value switch
        {
            "1w" => (value, 7, 1),
            "1m" => (value, 30, 30d / 7),
            "3m" => (value, 91, 91d / 7),
            _ => throw new DomainException("Choose a muscle range of 1w, 1m, or 3m.", 400)
        };
    }

    private static DateOnly LocalDate(DateTime utc, TimeZoneInfo zone)
    {
        var timestamp = DateTime.SpecifyKind(utc, DateTimeKind.Utc);
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(timestamp, zone));
    }

    private sealed class MuscleAccumulator
    {
        public double Sets { get; set; }
        public double PrimarySets { get; set; }
        public double SecondarySets { get; set; }
        public HashSet<Guid> Sessions { get; } = [];
        public DateOnly? LastTrainedDate { get; set; }
    }
}
