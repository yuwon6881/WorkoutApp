using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record WorkoutStrengthBaseline(Guid ExerciseId, string Name, double Value);
public sealed record WorkoutRepBaseline(Guid ExerciseId, string Name, List<PreviousRepRecord> Records);
public sealed record WorkoutPrBaseline(List<WorkoutStrengthBaseline> Strength, List<WorkoutRepBaseline> Reps,
    DateTime? LastFinishedAt, DateTime? LastStartedAt, long RebuiltAt);
public sealed record WorkoutPrMark(Guid Id, bool IsPr, double? Estimate, string? Kind, int? Reps);
public sealed record WorkoutSessionPrSummary(int Count, List<WorkoutPrMark> Exercises, List<WorkoutPrMark> Sets);

public static class WorkoutPrReadService
{
    private const int Version = 1;
    // Fixed stripes bound coordination memory independently of account count.
    private static readonly SemaphoreSlim[] Gates = Enumerable.Range(0, 32).Select(_ => new SemaphoreSlim(1)).ToArray();

    public static async Task<(Dictionary<Guid, (bool IsPr, double? PrE1rmKg, string? PrKind, int? PrReps)> ExercisePrs,
        Dictionary<Guid, (bool IsPr, double? Estimated1RmKg, string? PrKind, int? PrReps)> SetPrs,
        Dictionary<Guid, int> SessionPrCounts, Dictionary<(Guid, string), double> Bests, WorkoutRepPrResult RepBests)>
        Get(AppDb db, IReadOnlyList<WorkoutSession> sessions, CancellationToken ct)
    {
        if (db.CurrentUser == null || sessions.Count == 0) return await WorkoutViewBuilder.ComputePrs(db, sessions, ct);
        var gate = Gates[(db.CurrentUser.Value.GetHashCode() & int.MaxValue) % Gates.Length];
        // SQLite GETs already own the global read gate; taking a stripe first in a mutation
        // response would invert that lock order. PostgreSQL uses the computation stripe.
        var coordinated = !db.Database.IsSqlite() && db.Database.CurrentTransaction == null;
        if (coordinated) await gate.WaitAsync(ct);
        try
        {
            var generation = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
            var stored = await db.TrainingReadModels.AsNoTracking().SingleOrDefaultAsync(x => x.Kind == "pr-baseline" && x.SourceId == Guid.Empty, ct);
            WorkoutPrBaseline baseline;
            if (stored == null || stored.Version != Version || stored.Generation != generation.History)
            {
                await using var mutation = db.Database.CurrentTransaction == null ? await MutationLock.Acquire(db, db.CurrentUser, ct) : null;
                generation = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
                stored = await db.TrainingReadModels.SingleOrDefaultAsync(x => x.Kind == "pr-baseline" && x.SourceId == Guid.Empty, ct);
                baseline = stored?.Version == Version && stored.Generation == generation.History
                    ? Json.Read<WorkoutPrBaseline>(stored.Json) : await Rebuild(db, stored, generation, ct);
                if (mutation != null) await mutation.Commit(ct);
            }
            else baseline = Json.Read<WorkoutPrBaseline>(stored.Json);

            var ids = sessions.Where(x => x.FinishedAt != null).Select(x => x.Id).ToList();
            var rows = await db.TrainingReadModels.AsNoTracking().Where(x => x.Kind == "pr-session" && ids.Contains(x.SourceId)
                && x.Version == Version && x.Generation >= baseline.RebuiltAt).ToListAsync(ct);
            var exercisePrs = new Dictionary<Guid, (bool, double?, string?, int?)>();
            var setPrs = new Dictionary<Guid, (bool, double?, string?, int?)>();
            var counts = new Dictionary<Guid, int>();
            foreach (var row in rows)
            {
                var value = Json.Read<WorkoutSessionPrSummary>(row.Json);
                counts[row.SourceId] = value.Count;
                foreach (var mark in value.Exercises) exercisePrs[mark.Id] = (mark.IsPr, mark.Estimate, mark.Kind, mark.Reps);
                foreach (var mark in value.Sets) setPrs[mark.Id] = (mark.IsPr, mark.Estimate, mark.Kind, mark.Reps);
            }
            var bests = baseline.Strength.ToDictionary(x => (x.ExerciseId, x.Name), x => x.Value);
            var reps = new WorkoutRepPrResult([], [], [], baseline.Reps.ToDictionary(x => (x.ExerciseId, x.Name), x => x.Records));
            return (exercisePrs, setPrs, counts, bests, reps);
        }
        finally { if (coordinated) gate.Release(); }
    }

    private static async Task<WorkoutPrBaseline> Rebuild(AppDb db, TrainingReadModel? stored, ResourceGeneration generation, CancellationToken ct)
    {
        var previous = stored?.Version == Version ? Json.Read<WorkoutPrBaseline>(stored.Json) : null;
        var appended = generation.HistoryAppendId is { } id
            ? await db.Workouts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.FinishedAt != null, ct) : null;
        var canAppend = previous != null && stored!.Generation + 1 == generation.History && appended != null &&
            (previous.LastFinishedAt == null || appended.FinishedAt > previous.LastFinishedAt ||
                appended.FinishedAt == previous.LastFinishedAt && appended.StartedAt > previous.LastStartedAt);
        var baseline = canAppend ? previous! : new WorkoutPrBaseline([], [], null, null, generation.History);
        var query = db.Workouts.AsNoTracking().Where(x => x.FinishedAt != null);
        if (canAppend) query = query.Where(x => x.Id == appended!.Id);
        // Keep each source/calculator batch bounded. The baseline grows with exercise/load
        // combinations, not the number of sessions or sets.
        if (!canAppend)
            await db.TrainingReadModels.Where(x => x.Kind == "pr-session").ExecuteDeleteAsync(ct);
        DateTime? afterFinished = null;
        DateTime? afterStarted = null;
        Guid? afterId = null;
        while (true)
        {
            var page = query;
            if (afterFinished is { } finished && afterStarted is { } started && afterId is { } cursorId)
                page = page.Where(x => x.FinishedAt > finished || x.FinishedAt == finished &&
                    (x.StartedAt > started || x.StartedAt == started && x.Id.CompareTo(cursorId) > 0));
            var batch = await page.OrderBy(x => x.FinishedAt).ThenBy(x => x.StartedAt).ThenBy(x => x.Id).Take(64).ToListAsync(ct);
            if (batch.Count == 0) break;
            var result = await WorkoutViewBuilder.ComputePrs(db, batch, ct, baseline);
            var batchIds = batch.Select(x => x.Id).ToList();
            var exercises = await db.SessionExercises.AsNoTracking().Where(x => batchIds.Contains(x.SessionId))
                .Select(x => new { x.Id, x.SessionId }).ToListAsync(ct);
            var exerciseIds = exercises.Select(x => x.Id).ToList();
            var sets = await db.Sets.AsNoTracking().Where(x => exerciseIds.Contains(x.SessionExerciseId))
                .Select(x => new { x.Id, x.SessionExerciseId }).ToListAsync(ct);
            foreach (var session in batch)
            {
                var sessionExercises = exercises.Where(x => x.SessionId == session.Id).Select(x => x.Id).ToHashSet();
                var summary = new WorkoutSessionPrSummary(result.SessionPrCounts.GetValueOrDefault(session.Id),
                    sessionExercises.Where(result.ExercisePrs.ContainsKey).Select(id => Mark(id, result.ExercisePrs[id])).ToList(),
                    sets.Where(x => sessionExercises.Contains(x.SessionExerciseId) && result.SetPrs.ContainsKey(x.Id))
                        .Select(x => Mark(x.Id, result.SetPrs[x.Id])).ToList());
                db.TrainingReadModels.Add(new TrainingReadModel { UserId = db.CurrentUser!.Value, Kind = "pr-session", SourceId = session.Id,
                    Generation = generation.History, Version = Version, Json = Json.Write(summary) });
            }
            var last = batch[^1];
            afterFinished = last.FinishedAt; afterStarted = last.StartedAt; afterId = last.Id;
            baseline = new(result.Bests.Select(x => new WorkoutStrengthBaseline(x.Key.Item1, x.Key.Item2, x.Value)).ToList(),
                result.RepBests.PreviousByExercise.Select(x => new WorkoutRepBaseline(x.Key.Item1, x.Key.Item2, x.Value)).ToList(),
                last.FinishedAt, last.StartedAt, baseline.RebuiltAt);
            await db.SaveChangesAsync(ct);
            foreach (var entry in db.ChangeTracker.Entries<TrainingReadModel>().Where(x => x.Entity.Kind == "pr-session").ToList()) entry.State = EntityState.Detached;
            if (batch.Count < 64) break;
        }
        stored ??= new TrainingReadModel { UserId = db.CurrentUser!.Value, Kind = "pr-baseline", SourceId = Guid.Empty };
        if (db.Entry(stored).State == EntityState.Detached) db.TrainingReadModels.Add(stored);
        stored.Generation = generation.History; stored.Version = Version; stored.Json = Json.Write(baseline);
        await db.SaveChangesAsync(ct);
        return baseline;
    }

    private static WorkoutPrMark Mark(Guid id, (bool Pr, double? Estimate, string? Kind, int? Reps) value)
        => new(id, value.Pr, value.Estimate, value.Kind, value.Reps);
}
