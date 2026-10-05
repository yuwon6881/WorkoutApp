using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public record PreferencesInput(string Unit, string Theme, int? RestSeconds = null, bool? RestAlerts = null, bool? TrackRir = null)
{
    public void ApplyTo(AppUser user)
    {
        Validation.Unit(Unit); Validation.Theme(Theme);
        if (RestSeconds is { } rest) Validation.RestSeconds(rest);
        user.Unit = Unit; user.Theme = Theme;
        if (RestSeconds is { } restValue) user.RestSeconds = restValue;
        user.RestAlerts = RestAlerts ?? true;
        // An older client omits the field; that must not switch RIR tracking back on.
        if (TrackRir is { } trackRir) user.TrackRir = trackRir;
    }
}
public record StartInput(Guid? TemplateId, string? Name);
public record FinishInput(int? Revision, bool RetainExerciseSwaps = false, Guid? MutationId = null, DateTimeOffset? FinishedAt = null, FinishPlanUpdateInput? PlanUpdate = null);
public record ActivateInput(bool Active, int? Revision);
public record RevisionInput(int? Revision);
public record TemplateRestoreInput(int? Revision = null, Guid? IdempotencyId = null);

public static class TrainingEndpoints
{
    /// One call gives the signed-in app everything it needs to render: preferences, the catalog,
    /// plans, the active program, any workout still in progress, and a short history summary.
    public static void MapBootstrap(this WebApplication app)
        => app.MapGet("/api/bootstrap", async (AppDb db, CatalogService catalog, TemplateService templates, ProgramService programs, WorkoutService workouts, ImportService imports, IMemoryCache cache, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == db.CurrentUser, ct);
            var programList = await programs.List(ct);
            return new
            {
                account = new { user.Id, displayName = user.DisplayName },
                preferences = new { user.Unit, user.Theme, user.RestSeconds, user.RestAlerts, user.TrackRir },
                exercises = await catalog.All(ct),
                templates = await templates.List(null, standaloneOnly: true, ct),
                programs = programList,
                activeProgram = programList.FirstOrDefault(p => p.Active),
                activeWorkout = await workouts.Active(ct),
                imports = await imports.List(ct),
                history = await workouts.History(0, 20, ct),
                progress = await ProgressReadService.Get(db, cache, ct)
            };
        });

    public static void MapRevisions(this WebApplication app)
        => app.MapGet("/api/revisions", async (HttpContext http, AppDb db, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == db.CurrentUser, ct);
            var generation = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
            var programs = generation.Programs;
            var templates = generation.Templates;
            var sessions = generation.Sessions;
            var imports = generation.Imports;
            var progress = generation.Progress;
            var customExercises = generation.CustomExercises;
            var exerciseLoads = generation.ExerciseLoads;
            var etag = $"\"revisions:{user.Id:N}:{programs}:{templates}:{sessions}:{imports}:{progress}:{customExercises}:{exerciseLoads}:{generation.Preferences}\"";
            if (http.Request.Headers.IfNoneMatch == etag)
            {
                http.Response.Headers.ETag = etag;
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }
            http.Response.Headers.ETag = etag;
            return Results.Ok(new
            {
                account = user.Id,
                programs,
                templates,
                sessions,
                imports,
                progress,
                customExercises,
                exerciseLoads
            });
        });

    public static void MapCatalog(this WebApplication app)
    {
        app.MapGet("/api/exercises", async (CatalogService catalog, CancellationToken ct) => await catalog.All(ct));
        app.MapGet("/api/exercises/{exerciseId:guid}/load-settings", async (Guid exerciseId, string? unit, ExerciseLoadSettingsService settings, CancellationToken ct)
            => await settings.Get(exerciseId, ct, unit));
        app.MapPut("/api/exercises/{exerciseId:guid}/load-settings", async (Guid exerciseId, ExerciseLoadSettingsInput input, ExerciseLoadSettingsService settings, CancellationToken ct)
            => await settings.Save(exerciseId, input, ct));
        app.MapPost("/api/exercises/custom", async (CustomExerciseInput input, ExerciseService exercises, CancellationToken ct)
            => await exercises.Create(input, ct));
        app.MapDelete("/api/exercises/custom/{exerciseId:guid}", async (Guid exerciseId, ExerciseService exercises, CancellationToken ct)
            => { await exercises.ArchiveCustom(exerciseId, ct); return Results.NoContent(); });
        app.MapGet("/api/exercises/{exerciseId:guid}/insight", async (Guid exerciseId, string? range, int? page, int? size, ExerciseService exercises, CancellationToken ct)
            => await exercises.Insight(exerciseId, range, page ?? 0, size ?? 20, ct));
        app.MapGet("/api/exercises/{exerciseId:guid}/recent-sets", async (Guid exerciseId, int? limit, ExerciseService exercises, CancellationToken ct)
            => await exercises.RecentSets(exerciseId, limit ?? 3, ct));
        app.MapGet("/api/exercises/{exerciseId:guid}/clear-preview", async (Guid exerciseId, ExerciseService exercises, CancellationToken ct)
            => await exercises.ClearPreview(exerciseId, ct));
        app.MapPost("/api/exercises/{exerciseId:guid}/clear-history", async (Guid exerciseId, ExerciseService exercises, AppDb db,
            IServiceScopeFactory scopes, ILogger<WorkoutService> logger, HttpContext http, CancellationToken ct) =>
        {
            var result = await exercises.ClearHistory(exerciseId, ct);
            await IntegrationDispatch.AfterCommit(http,
                () => db.GoogleHealthWorkoutSyncWork.AsNoTracking().AnyAsync(work =>
                    work.ProcessingState == "pending" || work.ProcessingState == "processing" || work.ProcessingState == "awaiting_operation", ct),
                () => GoogleHealthWorkoutFlush.ForActiveUserAsync(scopes, db.CurrentUser, logger, ct));
            return result;
        });
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
            // Load rules keep the unit they were typed in and are mapped when read, so a unit
            // switch rewrites nothing and switching back restores every rule exactly.
            var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
            input.ApplyTo(user);
            await db.SaveChangesAsync(ct);
            return new { user.Unit, user.Theme, user.RestSeconds, user.RestAlerts, user.TrackRir };
        });
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
        app.MapPost("/api/templates/{id:guid}/restore", async (Guid id, TemplateRestoreInput? input, TemplateService templates, CancellationToken ct)
            => await templates.RestoreTemplate(id, input?.Revision, input?.IdempotencyId, ct));
        app.MapPost("/api/templates/{id:guid}/substitution/restore/preview", async (Guid id, TemplateSubstitutionRestoreInput input, TemplateService templates, CancellationToken ct)
            => await templates.PreviewRestore(id, input, ct));
        app.MapPost("/api/templates/{id:guid}/substitution/restore", async (Guid id, TemplateSubstitutionRestoreInput input, TemplateService templates, CancellationToken ct)
            => await templates.RestoreSubstitution(id, input, ct));
        app.MapPost("/api/templates/{id:guid}/exercise-substitution/restore", async (Guid id, TemplateSubstitutionRestoreInput input, TemplateService templates, CancellationToken ct)
            => await templates.RestoreSubstitution(id, input, ct));
        app.MapPost("/api/templates/{id:guid}/active", async (Guid id, ActivateInput input, ActiveSlotService slot, CancellationToken ct)
            => await slot.SetTemplateActive(id, input.Active, input.Revision, ct));
        app.MapPost("/api/templates/{id:guid}/restart", async (Guid id, RevisionInput input, ActiveSlotService slot, CancellationToken ct)
            => await slot.RestartTemplate(id, input.Revision, ct));
        app.MapDelete("/api/templates/{id:guid}", async (Guid id, TemplateService templates, CancellationToken ct) =>
        { await templates.Delete(id, ct); return Results.NoContent(); });
    }

    public static void MapPrograms(this WebApplication app)
    {
        app.MapGet("/api/programs", async (ProgramService programs, CancellationToken ct) => await programs.List(ct));
        app.MapGet("/api/programs/{id:guid}", async (Guid id, ProgramService programs, CancellationToken ct) => await programs.Get(id, ct));
        app.MapPost("/api/programs", async (ProgramInput input, ProgramService programs, CancellationToken ct) => await programs.Create(input, activate: true, sourceImportId: null, ct));
        app.MapPost("/api/programs/{id:guid}/active", async (Guid id, ActivateInput input, ProgramService programs, CancellationToken ct) => await programs.SetActive(id, input.Active, input.Revision, ct));
        app.MapPost("/api/programs/{id:guid}/workouts/{templateId:guid}/skip", async (Guid id, Guid templateId, ProgramDayActionInput input, ProgramService programs, CancellationToken ct)
            => await programs.Skip(id, templateId, input, ct));
        app.MapDelete("/api/programs/{id:guid}/workouts/{templateId:guid}/skip", async (Guid id, Guid templateId, ProgramService programs, CancellationToken ct)
            => await programs.Unskip(id, templateId, ct));
        app.MapPost("/api/programs/{id:guid}/days/{templateId:guid}/pass", async (Guid id, Guid templateId, ProgramDayActionInput input, ProgramService programs, CancellationToken ct)
            => await programs.AcknowledgeRest(id, templateId, input, ct));
        app.MapPost("/api/programs/{id:guid}/week/reset", async (Guid id, ProgramWeekResetInput input, ProgramService programs, CancellationToken ct)
            => await programs.ResetWeek(id, input, ct));
        app.MapPost("/api/programs/{id:guid}/restart", async (Guid id, RevisionInput input, ProgramService programs, CancellationToken ct)
            => await programs.Restart(id, input.Revision, ct));
        app.MapDelete("/api/programs/{id:guid}", async (Guid id, ProgramService programs, CancellationToken ct) =>
        { await programs.Delete(id, ct); return Results.NoContent(); });
    }

    public static void MapWorkouts(this WebApplication app)
    {
        app.MapGet("/api/workouts/active", async (WorkoutService workouts, CancellationToken ct) => await workouts.Active(ct));
        app.MapPost("/api/workouts", async (StartInput input, WorkoutService workouts, CancellationToken ct) => await workouts.Start(input.TemplateId, input.Name, ct));
        app.MapPut("/api/workouts/{id:guid}", async (Guid id, SessionInput input, WorkoutService workouts, CancellationToken ct) => await workouts.Save(id, input, ct));
        app.MapPatch("/api/workouts/{id:guid}/sets/{setId:guid}", async (Guid id, Guid setId, JsonElement payload, WorkoutService workouts, CancellationToken ct)
            => await workouts.PatchSet(id, setId, payload, ct));
        app.MapPost("/api/workouts/{id:guid}/substitution", async (Guid id, SessionSubstitutionInput input, WorkoutService workouts, CancellationToken ct)
            => await workouts.Swap(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/exercise-substitution", async (Guid id, SessionSubstitutionInput input, WorkoutService workouts, CancellationToken ct)
            => await workouts.Swap(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/swap", async (Guid id, SessionSubstitutionInput input, WorkoutService workouts, CancellationToken ct)
            => await workouts.Swap(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/exercises/{sessionExerciseId:guid}/restore", async (Guid id, Guid sessionExerciseId, SessionExerciseRestoreInput input, WorkoutService workouts, CancellationToken ct) =>
        {
            Validation.Require(input.SessionExerciseId == Guid.Empty || input.SessionExerciseId == sessionExerciseId, "Session exercise identifier mismatch.", 400);
            return await workouts.RestoreExercise(id, input with { SessionExerciseId = sessionExerciseId }, ct);
        });
        app.MapPost("/api/workouts/{id:guid}/restore", async (Guid id, SessionRestoreInput input, WorkoutService workouts, CancellationToken ct)
            => await workouts.RestoreWorkout(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/pause", async (Guid id, WorkoutTimingInput input, WorkoutService workouts, CancellationToken ct) => await workouts.Pause(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/resume", async (Guid id, WorkoutTimingInput input, WorkoutService workouts, CancellationToken ct) => await workouts.Resume(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/rest", async (Guid id, WorkoutRestMutationInput input, WorkoutService workouts, CancellationToken ct) => await workouts.MutateRest(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/finish", async (Guid id, FinishInput input, WorkoutService workouts, AppDb db, IServiceScopeFactory scopes, ILogger<WorkoutService> logger, HttpContext http, CancellationToken ct) =>
        {
            var finished = await workouts.Finish(id, input.Revision, ct, input.RetainExerciseSwaps, input.MutationId, input.FinishedAt, input.PlanUpdate);
            await IntegrationDispatch.AfterCommit(http,
                () => db.GoogleHealthWorkoutSyncWork.AsNoTracking().AnyAsync(work =>
                    work.ProcessingState == "pending" || work.ProcessingState == "processing" || work.ProcessingState == "awaiting_operation", ct),
                () => GoogleHealthWorkoutFlush.ForActiveUserAsync(scopes, db.CurrentUser, logger, ct));
            return finished;
        });
        app.MapPost("/api/workouts/{id:guid}/finish/preview", async (Guid id, WorkoutService workouts, CancellationToken ct)
            => await workouts.PreviewFinishPlan(id, ct));
        app.MapPost("/api/workouts/{id:guid}/discard", async (Guid id, WorkoutService workouts, CancellationToken ct) =>
        { await workouts.Discard(id, ct); return Results.NoContent(); });
        app.MapGet("/api/workouts/{id:guid}", async (Guid id, WorkoutService workouts, CancellationToken ct) => await workouts.Get(id, ct));
        app.MapDelete("/api/workouts/{id:guid}", async (Guid id, WorkoutService workouts, AppDb db, IServiceScopeFactory scopes, ILogger<WorkoutService> logger, HttpContext http, CancellationToken ct) =>
        {
            await workouts.DeleteFromHistory(id, ct);
            await IntegrationDispatch.AfterCommit(http,
                () => db.GoogleHealthWorkoutSyncWork.AsNoTracking().AnyAsync(work =>
                    work.ProcessingState == "pending" || work.ProcessingState == "processing" || work.ProcessingState == "awaiting_operation", ct),
                () => GoogleHealthWorkoutFlush.ForActiveUserAsync(scopes, db.CurrentUser, logger, ct));
            return Results.NoContent();
        });
        app.MapGet("/api/history", async (int? page, int? size, WorkoutService workouts, CancellationToken ct) => await workouts.History(page ?? 0, size ?? 20, ct));
        app.MapGet("/api/history/cursor", async (DateTime? beforeAt, Guid? beforeId, int? size, WorkoutService workouts, CancellationToken ct)
            => await workouts.HistoryCursor(beforeAt, beforeId, size ?? 20, ct));
        app.MapGet("/api/progress", async (AppDb db, IMemoryCache cache, CancellationToken ct) => await ProgressReadService.Get(db, cache, ct));
        app.MapGet("/api/progress/muscles", async (string? range, string? timeZone, MuscleBalanceService balance, CancellationToken ct)
            => await balance.Balance(range, timeZone, ct));
        app.MapGet("/api/workouts/activity", async (DateOnly? from, DateOnly? to, string? timeZone, WorkoutService workouts, CancellationToken ct)
            => await workouts.Activity(from, to, timeZone, ct));
    }
}
