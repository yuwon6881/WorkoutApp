using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class PerformanceEndpoints
{
    public static void MapPerformanceReads(this WebApplication app)
    {
        app.MapGet("/api/bootstrap/launch", async (AppDb db, ProgramService programs, WorkoutService workouts,
            ImportService imports, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleAsync(row => row.Id == db.CurrentUser, ct);
            var (program, next) = await programs.Launch(ct);
            if (program is null)
                next = await db.Templates.AsNoTracking().Where(day => day.ProgramId == null)
                    .OrderBy(day => day.Position).ThenBy(day => day.Id).Select(day => new NextWorkoutView(day.Id,
                        day.Name, day.Focus, day.Week, day.Position, db.TemplateExercises.Count(exercise => exercise.TemplateId == day.Id)))
                    .FirstOrDefaultAsync(ct);
            var generation = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
            return new {
                resourceVersions = ResourceVersions.For(generation, user.Unit),
                account = new { user.Id, displayName = user.DisplayName },
                preferences = new { user.Unit, user.Theme, user.RestSeconds, user.RestAlerts, user.TrackRir },
                activeWorkout = await workouts.Active(ct), activeProgram = program, nextWorkout = next,
                imports = await imports.LaunchSummaries(ct),
                navigationCounts = new { programs = await db.Programs.CountAsync(ct), templates = await db.Templates.CountAsync(day => day.ProgramId == null, ct) }
            };
        });
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
            var generation = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
            return new
            {
                resourceVersions = ResourceVersions.For(generation, user.Unit),
                account = new { user.Id, displayName = user.DisplayName },
                preferences = new { user.Unit, user.Theme, user.RestSeconds, user.RestAlerts, user.TrackRir },
                activeWorkout = await workouts.Active(ct), activeProgram = active, nextWorkout = next,
                imports = await imports.List(ct),
                navigationCounts = new { programs = await db.Programs.CountAsync(ct), templates = await db.Templates.CountAsync(x => x.ProgramId == null, ct) }
            };
        });
        app.MapGet("/api/history/summaries", async (DateTime? beforeAt, Guid? beforeId, int? size, AppDb db, CancellationToken ct)
            => await HistoryReadService.Get(db, beforeAt, beforeId, size ?? 20, ct));
    }
}
