using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public record PreferencesInput(string Unit, string Theme, int RestSeconds, bool? RestAlerts);
public record StartInput(Guid? TemplateId, string? Name);
public record FinishInput(int? Revision, bool RetainExerciseSwaps = false);
public record ActivateInput(bool Active, int? Revision);
public record ScheduleInput(DateOnly Anchor, List<ScheduleSlot> Slots, int? Revision);
public record RepeatProgramInput(string? TimeZone);

public static class TrainingEndpoints
{
    /// One call gives the signed-in app everything it needs to render: preferences, the catalog,
    /// plans, the active program, any workout still in progress, and a short history summary.
    public static void MapBootstrap(this WebApplication app)
        => app.MapGet("/api/bootstrap", async (AppDb db, CatalogService catalog, TemplateService templates, ProgramService programs, WorkoutService workouts, ImportService imports, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == db.CurrentUser, ct);
            var programList = await programs.List(ct);
            return new
            {
                account = new { user.Id, displayName = user.DisplayName },
                preferences = new { user.Unit, user.Theme, user.RestSeconds, user.RestAlerts },
                exercises = await catalog.All(ct),
                templates = await templates.List(null, standaloneOnly: true, ct),
                programs = programList,
                activeProgram = programList.FirstOrDefault(p => p.Active),
                activeWorkout = await workouts.Active(ct),
                imports = await imports.List(ct),
                history = await workouts.History(0, 10, ct),
                aiImportsRemaining = await Remaining(db, ct)
            };
        });

    public static void MapCatalog(this WebApplication app)
    {
        app.MapGet("/api/exercises", async (CatalogService catalog, CancellationToken ct) => await catalog.All(ct));
        app.MapPost("/api/exercises/custom", async (CustomExerciseInput input, ExerciseService exercises, CancellationToken ct)
            => await exercises.Create(input, ct));
        app.MapDelete("/api/exercises/custom/{exerciseId:guid}", async (Guid exerciseId, ExerciseService exercises, CancellationToken ct)
            => { await exercises.ArchiveCustom(exerciseId, ct); return Results.NoContent(); });
        app.MapGet("/api/exercises/{exerciseId:guid}/insight", async (Guid exerciseId, string? range, int? page, int? size, ExerciseService exercises, CancellationToken ct)
            => await exercises.Insight(exerciseId, range, page ?? 0, size ?? 20, ct));
        app.MapGet("/api/exercises/{exerciseId:guid}/clear-preview", async (Guid exerciseId, ExerciseService exercises, CancellationToken ct)
            => await exercises.ClearPreview(exerciseId, ct));
        app.MapPost("/api/exercises/{exerciseId:guid}/clear-history", async (Guid exerciseId, ExerciseService exercises, CancellationToken ct)
            => await exercises.ClearHistory(exerciseId, ct));
        app.MapGet("/api/exercises/substitutions", async (Guid? exerciseId, string? name, string? imported, string? q, CatalogService catalog, CancellationToken ct) =>
        {
            var alternatives = string.IsNullOrWhiteSpace(imported) ? [] : imported.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return await catalog.Substitutions(exerciseId, name, alternatives, q, ct);
        });
        app.MapGet("/api/exercises/{exerciseId:guid}/substitutions", async (Guid exerciseId, string? imported, string? q, CatalogService catalog, CancellationToken ct) =>
        {
            var alternatives = string.IsNullOrWhiteSpace(imported) ? [] : imported.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return await catalog.Substitutions(exerciseId, null, alternatives, q, ct);
        });
        app.MapGet("/api/substitutions/candidates", async (Guid? exerciseId, string? name, string? imported, string? q, CatalogService catalog, CancellationToken ct) =>
        {
            var alternatives = string.IsNullOrWhiteSpace(imported) ? [] : imported.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return await catalog.Substitutions(exerciseId, name, alternatives, q, ct);
        });

        app.MapPut("/api/preferences", async (PreferencesInput input, AppDb db, CancellationToken ct) =>
        {
            Validation.Unit(input.Unit); Validation.Theme(input.Theme); Validation.RestSeconds(input.RestSeconds);
            var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
            user.Unit = input.Unit; user.Theme = input.Theme; user.RestSeconds = input.RestSeconds; user.RestAlerts = input.RestAlerts ?? true;
            await db.SaveChangesAsync(ct);
            return new { user.Unit, user.Theme, user.RestSeconds, user.RestAlerts };
        });

        app.MapGet("/api/export", async (ExportService export, CancellationToken ct) => await export.Build(ct)).RequireRateLimiting("export");
    }

    public static void MapTemplates(this WebApplication app)
    {
        app.MapGet("/api/templates", async (TemplateService templates, CancellationToken ct) => await templates.List(null, standaloneOnly: true, ct));
        app.MapGet("/api/templates/{id:guid}", async (Guid id, TemplateService templates, CancellationToken ct) => await templates.Get(id, ct));
        app.MapPost("/api/templates", async (TemplateInput input, TemplateService templates, CancellationToken ct) => await templates.Create(input, null, 1, 0, ct));
        app.MapPut("/api/templates/{id:guid}", async (Guid id, TemplateInput input, TemplateService templates, CancellationToken ct) => await templates.Update(id, input, ct));
        app.MapPost("/api/templates/{id:guid}/substitution/preview", async (Guid id, TemplateSubstitutionInput input, TemplateService templates, CancellationToken ct)
            => await templates.Preview(id, input, ct));
        app.MapPost("/api/templates/{id:guid}/exercise-substitution/preview", async (Guid id, TemplateSubstitutionInput input, TemplateService templates, CancellationToken ct)
            => await templates.Preview(id, input, ct));
        app.MapPost("/api/templates/{id:guid}/substitution", async (Guid id, TemplateSubstitutionInput input, TemplateService templates, CancellationToken ct)
            => await templates.Swap(id, input, ct));
        app.MapPost("/api/templates/{id:guid}/exercise-substitution", async (Guid id, TemplateSubstitutionInput input, TemplateService templates, CancellationToken ct)
            => await templates.Swap(id, input, ct));
        app.MapPost("/api/templates/{id:guid}/swap", async (Guid id, TemplateSubstitutionInput input, TemplateService templates, CancellationToken ct)
            => await templates.Swap(id, input, ct));
        app.MapDelete("/api/templates/{id:guid}", async (Guid id, TemplateService templates, CancellationToken ct) =>
        { await templates.Delete(id, ct); return Results.NoContent(); });
    }

    public static void MapPrograms(this WebApplication app)
    {
        app.MapGet("/api/programs", async (ProgramService programs, CancellationToken ct) => await programs.List(ct));
        app.MapGet("/api/programs/{id:guid}", async (Guid id, ProgramService programs, CancellationToken ct) => await programs.Get(id, ct));
        app.MapPost("/api/programs", async (ProgramInput input, ProgramService programs, CancellationToken ct) => await programs.Create(input, activate: true, sourceImportId: null, ct));
        app.MapPost("/api/programs/{id:guid}/active", async (Guid id, ActivateInput input, ProgramService programs, CancellationToken ct) => await programs.SetActive(id, input.Active, input.Revision, ct));
        app.MapPost("/api/programs/{id:guid}/schedule", async (Guid id, ScheduleInput input, ProgramService programs, CancellationToken ct)
            => await programs.Schedule(id, input.Anchor, input.Slots, input.Revision, ct));
        app.MapPost("/api/programs/{id:guid}/workouts/{templateId:guid}/skip", async (Guid id, Guid templateId, ProgramService programs, CancellationToken ct)
            => await programs.Skip(id, templateId, ct));
        app.MapDelete("/api/programs/{id:guid}/workouts/{templateId:guid}/skip", async (Guid id, Guid templateId, ProgramService programs, CancellationToken ct)
            => await programs.Unskip(id, templateId, ct));
        app.MapPost("/api/programs/{id:guid}/repeat", async (Guid id, RepeatProgramInput? input, ProgramService programs, CancellationToken ct)
            => await programs.Repeat(id, input?.TimeZone, ct));
        app.MapDelete("/api/programs/{id:guid}", async (Guid id, ProgramService programs, CancellationToken ct) =>
        { await programs.Delete(id, ct); return Results.NoContent(); });
    }

    public static void MapWorkouts(this WebApplication app)
    {
        app.MapGet("/api/workouts/active", async (WorkoutService workouts, CancellationToken ct) => await workouts.Active(ct));
        app.MapPost("/api/workouts", async (StartInput input, WorkoutService workouts, CancellationToken ct) => await workouts.Start(input.TemplateId, input.Name, ct));
        app.MapPut("/api/workouts/{id:guid}", async (Guid id, SessionInput input, WorkoutService workouts, CancellationToken ct) => await workouts.Save(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/substitution", async (Guid id, SessionSubstitutionInput input, WorkoutService workouts, CancellationToken ct)
            => await workouts.Swap(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/exercise-substitution", async (Guid id, SessionSubstitutionInput input, WorkoutService workouts, CancellationToken ct)
            => await workouts.Swap(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/swap", async (Guid id, SessionSubstitutionInput input, WorkoutService workouts, CancellationToken ct)
            => await workouts.Swap(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/finish", async (Guid id, FinishInput input, WorkoutService workouts, CancellationToken ct) => await workouts.Finish(id, input.Revision, ct, input.RetainExerciseSwaps));
        app.MapPost("/api/workouts/{id:guid}/discard", async (Guid id, WorkoutService workouts, CancellationToken ct) =>
        { await workouts.Discard(id, ct); return Results.NoContent(); });
        app.MapGet("/api/workouts/{id:guid}", async (Guid id, WorkoutService workouts, CancellationToken ct) => await workouts.Get(id, ct));
        app.MapDelete("/api/workouts/{id:guid}", async (Guid id, WorkoutService workouts, CancellationToken ct) =>
        { await workouts.DeleteFromHistory(id, ct); return Results.NoContent(); });
        app.MapGet("/api/history", async (int? page, int? size, WorkoutService workouts, CancellationToken ct) => await workouts.History(page ?? 0, size ?? 20, ct));
        app.MapGet("/api/progress", async (AppDb db, WorkoutService workouts, CancellationToken ct) => await Progress(db, workouts, ct));
        app.MapGet("/api/workouts/schedule", async (DateOnly? from, DateOnly? to, WorkoutService workouts, CancellationToken ct)
            => await workouts.TrainingSummary(from, to, ct));
    }

    /// Per-exercise bests and recent volume, read from completed sets only.
    private static async Task<object> Progress(AppDb db, WorkoutService workouts, CancellationToken ct)
    {
        // Progress is an account aggregate. Do not page or truncate the source history here;
        // the history endpoint is paginated for rendering, while records must remain complete.
        var sessions = await db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null).OrderByDescending(w => w.FinishedAt).ToListAsync(ct);
        var ids = sessions.Select(s => s.Id).ToList();
        var exercises = await db.SessionExercises.AsNoTracking().Where(e => ids.Contains(e.SessionId)).ToListAsync(ct);
        var exerciseIds = exercises.Select(e => e.Id).ToList();
        var sets = await db.Sets.AsNoTracking().Where(s => exerciseIds.Contains(s.SessionExerciseId) && s.Done && !s.Warmup).ToListAsync(ct);
        var states = await db.Progress.AsNoTracking().ToListAsync(ct);
        var sessionById = sessions.ToDictionary(s => s.Id);
        var exerciseById = exercises.ToDictionary(exercise => exercise.Id);
        var volumeRows = sets.Select(set =>
        {
            var exercise = exerciseById[set.SessionExerciseId];
            var load = exercise.LoadModel == LoadModels.FullBodyweight ? set.SystemLoadKg : exercise.LoadModel == LoadModels.External ? set.WeightKg : null;
            return new { Set = set, Exercise = exercise, Load = load };
        }).Where(row => row.Load is not null && row.Set.Reps is not null).ToList();
        var totalVolume = volumeRows.Sum(row => row.Load!.Value * row.Set.Reps!.Value);
        var recentCutoff = DateTime.UtcNow.Date.AddDays(-6);
        var recentSessions = sessions.Where(session => (session.FinishedAt ?? session.StartedAt) >= recentCutoff).ToList();
        var recentIds = recentSessions.Select(x => x.Id).ToHashSet();
        var recentExerciseIds = exercises.Where(x => recentIds.Contains(x.SessionId)).Select(x => x.Id).ToHashSet();
        var recentWorkingSets = sets.Where(x => recentExerciseIds.Contains(x.SessionExerciseId)).ToList();
        var recentSets = volumeRows.Where(x => recentExerciseIds.Contains(x.Set.SessionExerciseId)).ToList();
        var trainingMinutes = sessions.Sum(session => Math.Max(1, (int)Math.Round(((session.FinishedAt ?? DateTime.UtcNow) - session.StartedAt).TotalMinutes)));
        var best = exercises.GroupBy(e => new { e.ExerciseId, e.NameSnapshot }).Select(group =>
        {
            var groupIds = group.Select(e => e.Id).ToHashSet();
            var logged = group.SelectMany(exercise => sets.Where(set => set.SessionExerciseId == exercise.Id)
                .Select(set => new { Exercise = exercise, Set = set, Session = sessionById[exercise.SessionId] })).ToList();
            // An unknown load cannot be a heaviest set; it is left out rather than counted as zero.
            var external = logged.Where(row => row.Exercise.LoadModel == LoadModels.External && row.Set.WeightKg != null).ToList();
            var heaviest = external.OrderByDescending(row => row.Set.WeightKg).ThenByDescending(row => row.Set.Reps).FirstOrDefault();
            var fullBodyweight = logged.Where(row => row.Exercise.LoadModel == LoadModels.FullBodyweight).ToList();
            var systemLoads = fullBodyweight.Where(row => row.Set.SystemLoadKg is not null).Select(row => row.Set.SystemLoadKg!.Value).ToList();
            var addedLoads = fullBodyweight.Where(row => row.Set.ResistanceMode == ResistanceModes.Added && row.Set.WeightKg is not null)
                .Select(row => row.Set.WeightKg!.Value).ToList();
            var assistanceLoads = fullBodyweight.Where(row => row.Set.ResistanceMode == ResistanceModes.Assistance && row.Set.WeightKg is not null)
                .Select(row => row.Set.WeightKg!.Value).ToList();
            var systemEstimateRows = fullBodyweight.Select(row => new { row.Session.FinishedAt, Estimate = Progression.E1rm(row.Set.SystemLoadKg, row.Set.Reps, row.Set.Rpe) })
                .Where(row => row.Estimate is not null).ToList();
            var systemEstimates = systemEstimateRows.Select(row => row.Estimate!.Value).ToList();
            var latestSystemEstimate = systemEstimateRows.OrderByDescending(row => row.FinishedAt).FirstOrDefault()?.Estimate;
            var relativeEstimates = fullBodyweight.Select(row =>
            {
                var snapshot = ReadBodyWeight(row.Session);
                var estimate = Progression.E1rm(row.Set.SystemLoadKg, row.Set.Reps, row.Set.Rpe);
                if (estimate is not { } value || snapshot?.ReferenceKg is not { } reference || reference <= 0) return null;
                return (double?)(value / reference);
            }).OfType<double>().ToList();
            var repRows = logged.Where(row => row.Set.Reps is not null).ToList();
            var bodyweightRep = logged.Where(row => row.Exercise.LoadModel == LoadModels.BodyweightContextOnly && row.Set.Reps is not null)
                .Select(row => new { row.Set.Reps, Snapshot = ReadBodyWeight(row.Session) })
                .Where(row => row.Snapshot?.ReferenceKg is not null)
                .OrderByDescending(row => row.Reps).ThenByDescending(row => row.Snapshot!.ReferenceKg).FirstOrDefault();
            var key = ProgressionService.Key(group.Key.ExerciseId, group.Key.NameSnapshot);
            var state = states.FirstOrDefault(s => s.ExerciseId == key.ExerciseId && s.NameKey == key.NameKey);
            return new
            {
                exerciseId = group.Key.ExerciseId,
                exercise = group.Key.NameSnapshot,
                sessions = group.Select(e => e.SessionId).Distinct().Count(),
                heaviestKg = heaviest?.Set.WeightKg,
                heaviestReps = heaviest?.Set.Reps,
                volumeKg = external.Count == 0 ? (double?)null : external.Sum(row => row.Set.WeightKg!.Value * row.Set.Reps!.GetValueOrDefault()),
                // Estimates exist only where sets could support one, so they stay absent rather
                // than appearing as a confident zero.
                estimatedMaxKg = fullBodyweight.Count > 0 ? (systemEstimates.Count == 0 ? (double?)null : systemEstimates.Max()) : external.Count > 0 ? state?.TrendE1rmKg : null,
                lastEstimatedMaxKg = fullBodyweight.Count > 0 ? latestSystemEstimate : external.Count > 0 ? state?.LastE1rmKg : null,
                externalLoadPrKg = external.Count == 0 ? (double?)null : external.Max(row => row.Set.WeightKg!.Value),
                addedLoadPrKg = addedLoads.Count == 0 ? (double?)null : addedLoads.Max(),
                assistanceReductionPrKg = assistanceLoads.Count == 0 ? (double?)null : assistanceLoads.Min(),
                systemLoadPrKg = systemLoads.Count == 0 ? (double?)null : systemLoads.Max(),
                repPr = repRows.Count == 0 ? (int?)null : repRows.Max(row => row.Set.Reps!.Value),
                estimatedSystemLoadMaxKg = systemEstimates.Count == 0 ? (double?)null : systemEstimates.Max(),
                relativeStrength = relativeEstimates.Count == 0 ? (double?)null : relativeEstimates.Max(),
                bodyweightRepRecord = bodyweightRep is null ? null : new { reps = bodyweightRep.Reps, bodyweightKg = bodyweightRep.Snapshot!.ReferenceKg }
            };
        }).OrderByDescending(x => x.sessions).ToList();
        return new
        {
            sessions = sessions.Count,
            exercises = best,
            totalVolumeKg = totalVolume == 0 && !sets.Any(set => set.WeightKg == 0) ? (double?)null : totalVolume,
            workingSets = sets.Count,
            trainingMinutes,
            weekSessions = recentSessions.Count,
            weekVolumeKg = recentSets.Count == 0 ? (double?)null : recentSets.Sum(row => row.Load!.Value * row.Set.Reps!.Value),
            weekWorkingSets = recentWorkingSets.Count
        };
    }

    private static BodyWeightSnapshot? ReadBodyWeight(WorkoutSession session)
    {
        if (string.IsNullOrWhiteSpace(session.BodyWeightSnapshotJson)) return null;
        try { return Json.Read<BodyWeightSnapshot>(session.BodyWeightSnapshotJson); }
        catch (DomainException) { return null; }
    }

    private static async Task<int> Remaining(AppDb db, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var usage = await db.Usage.AsNoTracking().SingleOrDefaultAsync(u => u.Date == today, ct);
        return Math.Max(0, ImportService.DailyLimit - (usage?.Count ?? 0));
    }
}
