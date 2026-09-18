using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record CustomExerciseInput(string Name, string? Muscle, string? Equipment, string? Cue,
    double LoadStepKg = 2.5, string LoadModel = LoadModels.External, string? MovementPattern = null);

public record CustomExerciseView(Guid Id, string Name, string Muscle, string Equipment, string Cue,
    double LoadStepKg, string LoadModel, string MovementPattern, bool Archived, DateTime CreatedAt);

public record ExerciseMetricPoint(DateOnly Date, Guid SessionId, string SessionName,
    double? Estimated1RmKg, double? LoadKg, double? VolumeKg, int? Reps, bool Partial);

public record ExerciseHistoryRow(Guid SessionId, string SessionName, DateOnly Date, int SetCount,
    double? VolumeKg, bool Partial, DateTime? FinishedAt);

public record ExerciseHistoryClearView(DateTime ClearedAt, int RemovedSets, int AffectedWorkouts);

public record ExerciseInsight(Guid Id, string Name, string Muscle, string Equipment, string Cue,
    string LoadModel, double LoadStepKg, bool IsCustom, bool Archived, int Sessions, int SetCount,
    int ClearableSetCount,
    double? Estimated1RmKg, DateOnly? Estimated1RmDate, double? HeaviestKg, int? HeaviestReps,
    DateOnly? HeaviestDate, double? LargestSetVolumeKg, DateOnly? LargestSetVolumeDate,
    double? LargestSessionVolumeKg, DateOnly? LargestSessionVolumeDate, int? RepPr,
    DateOnly? RepPrDate, DateOnly? LastPerformedDate, bool PartialVolume, List<ExerciseMetricPoint> Points,
    List<ExerciseHistoryRow> History, int Page, int Size, int TotalHistoryRows,
    double? ExternalLoadPrKg = null, double? AddedLoadPrKg = null, double? AssistanceReductionPrKg = null,
    double? SystemLoadPrKg = null, List<ExerciseHistoryClearView>? HistoryClears = null);

public record ExerciseClearPreview(Guid ExerciseId, string Name, int AffectedWorkouts, int AffectedSets,
    bool HasActiveWorkout, bool CanClear);

/// Account-owned exercise creation and server-authoritative exercise analytics. The service keeps
/// the shared catalog read-only and uses stable exercise ids for every historical query.
public sealed class ExerciseService(AppDb db)
{
    public async Task<CustomExerciseView> Create(CustomExerciseInput input, CancellationToken ct)
    {
        Validation.Name(input.Name, "Exercise name", 160);
        Validation.Text(input.Muscle, 80, "Muscle");
        Validation.Text(input.Equipment, 80, "Equipment");
        Validation.Text(input.Cue, 1000, "Instructions");
        Validation.Text(input.MovementPattern, 80, "Movement pattern");
        Validation.Require(LoadModels.All.Contains(input.LoadModel), "Choose a valid load model.");
        Validation.Number(input.LoadStepKg, 0, 50, "Load increment");
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var normalized = CatalogService.Normalize(input.Name);
        var sharedNames = await db.Exercises.AsNoTracking().Where(x => x.Active).Select(x => x.Name).ToListAsync(ct);
        Validation.Require(!sharedNames.Any(name => CatalogService.Normalize(name) == normalized),
            "That name is already in the shared exercise library.", 409);
        var customNames = await db.CustomExercises.AsNoTracking().Where(x => !x.Archived).Select(x => x.Name).ToListAsync(ct);
        Validation.Require(!customNames.Any(name => CatalogService.Normalize(name) == normalized),
            "You already have a custom exercise with that name.", 409);
        var row = new CustomExercise
        {
            UserId = db.CurrentUser!.Value, Name = input.Name.Trim(), Muscle = input.Muscle?.Trim() ?? "",
            Equipment = input.Equipment?.Trim() ?? "", Cue = input.Cue?.Trim() ?? "", LoadStepKg = input.LoadStepKg,
            LoadModel = input.LoadModel, MovementPattern = input.MovementPattern?.Trim() ?? ""
        };
        db.CustomExercises.Add(row);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return View(row);
    }

    public async Task ArchiveCustom(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var row = await db.CustomExercises.SingleOrDefaultAsync(x => x.Id == id, ct);
        Validation.Require(row != null, "That custom exercise no longer exists.", 404);
        Validation.Require(!row!.Archived, "That custom exercise is already deleted.", 409);
        Validation.Require(!await db.SessionExercises.AnyAsync(x => x.ExerciseId == id && db.Workouts.Any(w => w.Id == x.SessionId && w.Active), ct),
            "Finish or discard the active workout before deleting this exercise.", 409);
        row.Archived = true;
        row.ArchivedAt = DateTime.UtcNow;
        row.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public async Task<ExerciseClearPreview> ClearPreview(Guid id, CancellationToken ct)
    {
        var meta = await Metadata(id, ct);
        var rows = await FinishedExerciseRows(id, ct);
        var exerciseIds = rows.Select(x => x.Id).ToList();
        var sets = exerciseIds.Count == 0 ? 0 : await db.Sets.CountAsync(x => exerciseIds.Contains(x.SessionExerciseId), ct);
        var active = await db.SessionExercises.AnyAsync(x => x.ExerciseId == id && db.Workouts.Any(w => w.Id == x.SessionId && w.Active), ct);
        return new ExerciseClearPreview(id, meta.Name, rows.Select(x => x.SessionId).Distinct().Count(), sets, active, !active && sets > 0);
    }

    public async Task<ExerciseClearPreview> ClearHistory(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var meta = await Metadata(id, ct);
        var rows = await FinishedExerciseRows(id, ct);
        var active = await db.SessionExercises.AnyAsync(x => x.ExerciseId == id && db.Workouts.Any(w => w.Id == x.SessionId && w.Active), ct);
        Validation.Require(!active, "Finish or discard the active workout before clearing this exercise's history.", 409);
        var exerciseIds = rows.Select(x => x.Id).ToList();
        var sets = exerciseIds.Count == 0 ? [] : await db.Sets.Where(x => exerciseIds.Contains(x.SessionExerciseId)).ToListAsync(ct);
        db.Sets.RemoveRange(sets);
        foreach (var row in rows)
        {
            // A finished session remains a date/note placeholder, but its old progression
            // suggestion must not survive a history reset in an export or a later view.
            row.ProgressionJson = "";
            row.Revision++;
        }
        var progress = await db.Progress.Where(x => x.ExerciseId == id).ToListAsync(ct);
        db.Progress.RemoveRange(progress);
        if (sets.Count > 0)
            db.ExerciseHistoryClears.Add(new ExerciseHistoryClear
            {
                UserId = db.CurrentUser!.Value, ExerciseId = id, NameSnapshot = meta.Name,
                RemovedSets = sets.Count, AffectedWorkouts = rows.Select(x => x.SessionId).Distinct().Count()
            });
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return new ExerciseClearPreview(id, meta.Name, rows.Select(x => x.SessionId).Distinct().Count(), sets.Count, false, false);
    }

    public async Task<ExerciseInsight> Insight(Guid id, string? range, int page, int size, CancellationToken ct)
    {
        Validation.Require(page >= 0 && size is > 0 and <= 100, "Invalid exercise history page.");
        var meta = await Metadata(id, ct);
        var rows = await FinishedExerciseRows(id, ct);
        var sessions = await db.Workouts.AsNoTracking().Where(x => rows.Select(r => r.SessionId).Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, ct);
        var allSets = rows.Count == 0 ? [] : await db.Sets.AsNoTracking().Where(x => rows.Select(r => r.Id).Contains(x.SessionExerciseId)).ToListAsync(ct);
        var sets = allSets.Where(x => x.Done && !x.Warmup).ToList();
        var byExercise = rows.ToDictionary(x => x.Id);
        var records = new List<(Guid SessionId, DateOnly Date, string Name, double? E1rm, double? Load, double? Volume, int? Reps, bool Partial)>();
        foreach (var group in rows.GroupBy(x => x.SessionId))
        {
            var session = sessions[group.Key];
            var groupSets = sets.Where(x => group.Select(e => e.Id).Contains(x.SessionExerciseId)).ToList();
            if (groupSets.Count == 0) continue;
            var loadExpected = meta.LoadModel is LoadModels.External or LoadModels.FullBodyweight;
            var partial = loadExpected && groupSets.Any(x => EffectiveLoad(x, meta.LoadModel) is null);
            var volume = groupSets.Select(x => (Load: EffectiveLoad(x, meta.LoadModel), x.Reps)).Where(x => x.Load is not null && x.Reps is not null)
                .Select(x => x.Load!.Value * x.Reps!.Value).ToList();
            var estimates = groupSets.Select(x => Progression.E1rm(EffectiveLoad(x, meta.LoadModel), x.Reps, x.Rpe)).Where(x => x is not null).Select(x => x!.Value).ToList();
            var best = groupSets.Where(x => EffectiveLoad(x, meta.LoadModel) is not null).OrderByDescending(x => EffectiveLoad(x, meta.LoadModel)).FirstOrDefault();
            var rep = groupSets.Where(x => x.Reps is not null).OrderByDescending(x => x.Reps).FirstOrDefault();
            records.Add((group.Key, DateOnly.FromDateTime(session.FinishedAt!.Value), session.Name,
                estimates.Count == 0 ? null : estimates.Max(), best == null ? null : EffectiveLoad(best, meta.LoadModel),
                volume.Count == 0 ? null : volume.Sum(), rep?.Reps, partial));
        }
        var cutoff = range switch
        {
            "1m" => DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(-1),
            "6m" => DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(-6),
            "all" => DateOnly.MinValue,
            _ => DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(-3)
        };
        var filtered = records.Where(x => x.Date >= cutoff).OrderBy(x => x.Date).ToList();
        var history = records.OrderByDescending(x => x.Date).ThenByDescending(x => sessions[x.SessionId].FinishedAt).ToList();
        var historyRows = history.Select(x => new ExerciseHistoryRow(x.SessionId, x.Name, x.Date,
            sets.Count(s => byExercise[s.SessionExerciseId].SessionId == x.SessionId), x.Volume, x.Partial, sessions[x.SessionId].FinishedAt)).ToList();
        var paged = historyRows.Skip(page * size).Take(size).ToList();
        var bestE = records.Where(x => x.E1rm is not null).OrderByDescending(x => x.E1rm).FirstOrDefault();
        var heavy = records.Where(x => x.Load is not null).OrderByDescending(x => x.Load).FirstOrDefault();
        var setRecords = sets.Select(x => (Set: x, Session: sessions[byExercise[x.SessionExerciseId].SessionId], Load: EffectiveLoad(x, meta.LoadModel)))
            .Where(x => x.Load is not null && x.Set.Reps is not null).ToList();
        var largestSet = setRecords.OrderByDescending(x => x.Load!.Value * x.Set.Reps!.Value).FirstOrDefault();
        var largestSession = records.Where(x => x.Volume is not null).OrderByDescending(x => x.Volume).FirstOrDefault();
        var reps = setRecords.OrderByDescending(x => x.Set.Reps).FirstOrDefault();
        var last = records.OrderByDescending(x => x.Date).FirstOrDefault();
        var points = filtered.Select(x => new ExerciseMetricPoint(x.Date, x.SessionId, x.Name, x.E1rm, x.Load, x.Volume, x.Reps, x.Partial)).ToList();
        var externalLoads = sets.Where(x => meta.LoadModel == LoadModels.External && x.WeightKg is not null).Select(x => x.WeightKg!.Value).ToList();
        var bodyweightSets = sets.Where(x => meta.LoadModel == LoadModels.FullBodyweight).ToList();
        var addedLoads = bodyweightSets.Where(x => x.ResistanceMode == ResistanceModes.Added && x.WeightKg is not null).Select(x => x.WeightKg!.Value).ToList();
        var assistanceLoads = bodyweightSets.Where(x => x.ResistanceMode == ResistanceModes.Assistance && x.WeightKg is not null).Select(x => x.WeightKg!.Value).ToList();
        var systemLoads = bodyweightSets.Where(x => x.SystemLoadKg is not null).Select(x => x.SystemLoadKg!.Value).ToList();
        var clears = await db.ExerciseHistoryClears.AsNoTracking().Where(x => x.ExerciseId == id).OrderByDescending(x => x.ClearedAt)
            .Take(10).Select(x => new ExerciseHistoryClearView(x.ClearedAt, x.RemovedSets, x.AffectedWorkouts)).ToListAsync(ct);
        return new ExerciseInsight(id, meta.Name, meta.Muscle, meta.Equipment, meta.Cue, meta.LoadModel, meta.LoadStepKg,
            meta.IsCustom, meta.Archived, records.Select(x => x.SessionId).Distinct().Count(), sets.Count, allSets.Count,
            bestE.E1rm, bestE.E1rm is null ? null : bestE.Date, heavy.Load, heavy.Load is null ? null : records.First(x => x.SessionId == heavy.SessionId).Reps,
            heavy.Load is null ? null : heavy.Date, largestSet.Load is null ? null : largestSet.Load.Value * largestSet.Set.Reps!.Value,
            largestSet.Load is null ? null : DateOnly.FromDateTime(largestSet.Session.FinishedAt!.Value), largestSession.Volume,
            largestSession.Volume is null ? null : largestSession.Date,
            // An exercise can have finished sessions and still no set that states both a load and
            // reps — every load unknown, for instance — and the empty tuple's Set is null.
            reps.Set?.Reps, reps.Set?.Reps is null ? null : DateOnly.FromDateTime(reps.Session.FinishedAt!.Value),
            last.Date == default ? null : last.Date, records.Any(x => x.Partial), points, paged, page, size, historyRows.Count,
            externalLoads.Count == 0 ? null : externalLoads.Max(),
            addedLoads.Count == 0 ? null : addedLoads.Max(),
            assistanceLoads.Count == 0 ? null : assistanceLoads.Min(),
            systemLoads.Count == 0 ? null : systemLoads.Max(), clears);
    }

    private async Task<(string Name, string Muscle, string Equipment, string Cue, string LoadModel, double LoadStepKg, bool IsCustom, bool Archived)> Metadata(Guid id, CancellationToken ct)
    {
        var catalogRow = await db.Exercises.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        if (catalogRow != null) return (catalogRow.Name, catalogRow.Muscle, catalogRow.Equipment, catalogRow.Cue, catalogRow.LoadModel, catalogRow.LoadStepKg, false, !catalogRow.Active);
        var custom = await db.CustomExercises.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        Validation.Require(custom != null, "That exercise no longer exists.", 404);
        return (custom!.Name, custom.Muscle, custom.Equipment, custom.Cue, custom.LoadModel, custom.LoadStepKg, true, custom.Archived);
    }

    private async Task<List<SessionExercise>> FinishedExerciseRows(Guid id, CancellationToken ct)
        => await db.SessionExercises.AsNoTracking().Where(x => x.ExerciseId == id && db.Workouts.Any(w => w.Id == x.SessionId && w.FinishedAt != null)).ToListAsync(ct);

    private static double? EffectiveLoad(CompletedSet set, string loadModel)
        => loadModel == LoadModels.FullBodyweight ? set.SystemLoadKg : set.WeightKg;

    private static CustomExerciseView View(CustomExercise row)
        => new(row.Id, row.Name, row.Muscle, row.Equipment, row.Cue, row.LoadStepKg, row.LoadModel, row.MovementPattern, row.Archived, row.CreatedAt);
}
