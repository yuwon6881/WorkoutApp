using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class PerformanceEndpoints
{
    public static void MapPerformanceReads(this WebApplication app)
    {
        app.MapGet("/api/bootstrap/shell", async (AppDb db, ProgramService programs, WorkoutService workouts,
            ImportService imports, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == db.CurrentUser, ct);
            var active = (await programs.List(ct, activeOnly: true)).FirstOrDefault();
            var standalone = await db.Templates.AsNoTracking().Where(x => x.ProgramId == null)
                .OrderBy(x => x.Position).ThenBy(x => x.Id).Select(x => new { x.Id, x.Name, x.Focus, x.Week, x.Position }).FirstOrDefaultAsync(ct);
            object? next = active?.Days.FirstOrDefault(x => x.Id == active.NextTemplateId);
            if (active == null && standalone != null)
                next = new { standalone.Id, standalone.Name, standalone.Focus, standalone.Week, standalone.Position,
                    exerciseCount = await db.TemplateExercises.CountAsync(x => x.TemplateId == standalone.Id, ct) };
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var used = await db.Usage.AsNoTracking().Where(x => x.Date == today).Select(x => (int?)x.Count).SingleOrDefaultAsync(ct) ?? 0;
            var generation = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
            return new
            {
                resourceVersions = new { catalog = $"{generation.CustomExercises}:{generation.ExerciseLoads}",
                    programs = $"{generation.Programs}:{generation.Templates}", templates = $"{generation.Templates}:{generation.ExerciseLoads}" },
                account = new { user.Id, displayName = user.DisplayName },
                preferences = new { user.Unit, user.Theme, user.RestSeconds, user.RestAlerts },
                activeWorkout = await workouts.Active(ct), activeProgram = active, nextWorkout = next,
                imports = await imports.List(ct), aiImportsRemaining = Math.Max(0, ImportService.DailyLimit - used),
                navigationCounts = new { programs = await db.Programs.CountAsync(ct), templates = await db.Templates.CountAsync(x => x.ProgramId == null, ct) }
            };
        });
        app.MapGet("/api/history/summaries", async (DateTime? beforeAt, Guid? beforeId, int? size, AppDb db, CancellationToken ct)
            => await HistoryReadService.Get(db, beforeAt, beforeId, size ?? 20, ct));
    }
}
