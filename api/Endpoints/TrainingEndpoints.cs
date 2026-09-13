using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public record PreferencesInput(string Unit, string Theme, int RestSeconds);
public record StartInput(Guid? TemplateId, string? Name);
public record FinishInput(int? Revision);
public record ActivateInput(bool Active, int? Revision);

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
                account = new { user.Id, user.Username },
                preferences = new { user.Unit, user.Theme, user.RestSeconds },
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

        app.MapPut("/api/preferences", async (PreferencesInput input, AppDb db, CancellationToken ct) =>
        {
            Validation.Unit(input.Unit); Validation.Theme(input.Theme); Validation.RestSeconds(input.RestSeconds);
            var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
            user.Unit = input.Unit; user.Theme = input.Theme; user.RestSeconds = input.RestSeconds;
            await db.SaveChangesAsync(ct);
            return new { user.Unit, user.Theme, user.RestSeconds };
        });

        app.MapGet("/api/export", async (ExportService export, CancellationToken ct) => await export.Build(ct)).RequireRateLimiting("export");
    }

    public static void MapTemplates(this WebApplication app)
    {
        app.MapGet("/api/templates", async (TemplateService templates, CancellationToken ct) => await templates.List(null, standaloneOnly: true, ct));
        app.MapGet("/api/templates/{id:guid}", async (Guid id, TemplateService templates, CancellationToken ct) => await templates.Get(id, ct));
        app.MapPost("/api/templates", async (TemplateInput input, TemplateService templates, CancellationToken ct) => await templates.Create(input, null, 1, 0, ct));
        app.MapPut("/api/templates/{id:guid}", async (Guid id, TemplateInput input, TemplateService templates, CancellationToken ct) => await templates.Update(id, input, ct));
        app.MapDelete("/api/templates/{id:guid}", async (Guid id, TemplateService templates, CancellationToken ct) =>
        { await templates.Delete(id, ct); return Results.NoContent(); });
    }

    public static void MapPrograms(this WebApplication app)
    {
        app.MapGet("/api/programs", async (ProgramService programs, CancellationToken ct) => await programs.List(ct));
        app.MapGet("/api/programs/{id:guid}", async (Guid id, ProgramService programs, CancellationToken ct) => await programs.Get(id, ct));
        app.MapPost("/api/programs", async (ProgramInput input, ProgramService programs, CancellationToken ct) => await programs.Create(input, activate: true, sourceImportId: null, ct));
        app.MapPost("/api/programs/{id:guid}/active", async (Guid id, ActivateInput input, ProgramService programs, CancellationToken ct) => await programs.SetActive(id, input.Active, input.Revision, ct));
        app.MapDelete("/api/programs/{id:guid}", async (Guid id, ProgramService programs, CancellationToken ct) =>
        { await programs.Delete(id, ct); return Results.NoContent(); });
    }

    public static void MapWorkouts(this WebApplication app)
    {
        app.MapGet("/api/workouts/active", async (WorkoutService workouts, CancellationToken ct) => await workouts.Active(ct));
        app.MapPost("/api/workouts", async (StartInput input, WorkoutService workouts, CancellationToken ct) => await workouts.Start(input.TemplateId, input.Name, ct));
        app.MapPut("/api/workouts/{id:guid}", async (Guid id, SessionInput input, WorkoutService workouts, CancellationToken ct) => await workouts.Save(id, input, ct));
        app.MapPost("/api/workouts/{id:guid}/finish", async (Guid id, FinishInput input, WorkoutService workouts, CancellationToken ct) => await workouts.Finish(id, input.Revision, ct));
        app.MapPost("/api/workouts/{id:guid}/discard", async (Guid id, WorkoutService workouts, CancellationToken ct) =>
        { await workouts.Discard(id, ct); return Results.NoContent(); });
        app.MapGet("/api/workouts/{id:guid}", async (Guid id, WorkoutService workouts, CancellationToken ct) => await workouts.Get(id, ct));
        app.MapDelete("/api/workouts/{id:guid}", async (Guid id, WorkoutService workouts, CancellationToken ct) =>
        { await workouts.DeleteFromHistory(id, ct); return Results.NoContent(); });
        app.MapGet("/api/history", async (int? page, int? size, WorkoutService workouts, CancellationToken ct) => await workouts.History(page ?? 0, size ?? 20, ct));
        app.MapGet("/api/progress", async (AppDb db, WorkoutService workouts, CancellationToken ct) => await Progress(db, workouts, ct));
    }

    /// Per-exercise bests and recent volume, read from completed sets only.
    private static async Task<object> Progress(AppDb db, WorkoutService workouts, CancellationToken ct)
    {
        var sessions = await db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null).OrderByDescending(w => w.FinishedAt).Take(200).ToListAsync(ct);
        var ids = sessions.Select(s => s.Id).ToList();
        var exercises = await db.SessionExercises.AsNoTracking().Where(e => ids.Contains(e.SessionId)).ToListAsync(ct);
        var exerciseIds = exercises.Select(e => e.Id).ToList();
        var sets = await db.Sets.AsNoTracking().Where(s => exerciseIds.Contains(s.SessionExerciseId) && s.Done).ToListAsync(ct);
        var best = exercises.GroupBy(e => e.NameSnapshot).Select(group =>
        {
            var groupIds = group.Select(e => e.Id).ToHashSet();
            // An unknown load cannot be a heaviest set; it is left out rather than counted as zero.
            var known = sets.Where(s => groupIds.Contains(s.SessionExerciseId) && s.WeightKg != null).ToList();
            var heaviest = known.OrderByDescending(s => s.WeightKg).ThenByDescending(s => s.Reps).FirstOrDefault();
            return new
            {
                exercise = group.Key,
                sessions = group.Select(e => e.SessionId).Distinct().Count(),
                heaviestKg = heaviest?.WeightKg,
                heaviestReps = heaviest?.Reps,
                volumeKg = known.Count == 0 ? (double?)null : known.Sum(s => s.WeightKg!.Value * s.Reps!.Value)
            };
        }).OrderByDescending(x => x.sessions).ToList();
        return new { sessions = sessions.Count, exercises = best };
    }

    private static async Task<int> Remaining(AppDb db, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var usage = await db.Usage.AsNoTracking().SingleOrDefaultAsync(u => u.Date == today, ct);
        return Math.Max(0, ImportService.DailyLimit - (usage?.Count ?? 0));
    }
}
