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
                next = await ProgramService.StandaloneNext(db, ct);
            var generation = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
            var activeWorkout = await workouts.Active(ct);
            return new {
                resourceVersions = ResourceVersions.For(generation, user.Unit),
                account = new { user.Id, displayName = user.DisplayName },
                preferences = new { user.Unit, user.Theme, user.RestSeconds, user.RestAlerts, user.TrackRir },
                activeWorkout, activeProgram = program, nextWorkout = next,
                workoutHero = await WorkoutHeroReadService.Get(db, next?.Id, activeWorkout, ct),
                imports = await imports.LaunchSummaries(ct),
                gym = await GymProfiles.Launch(db, ct),
                navigationCounts = new { programs = await db.Programs.CountAsync(ct), templates = await db.Templates.CountAsync(day => day.ProgramId == null, ct) }
            };
        });
        app.MapGet("/api/bootstrap/shell", async (AppDb db, ProgramService programs, WorkoutService workouts,
            ImportService imports, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == db.CurrentUser, ct);
            var active = (await programs.List(ct, activeOnly: true)).FirstOrDefault();
            object? next = active?.Days.FirstOrDefault(x => x.Id == active.NextTemplateId);
            if (active == null)
                next = await ProgramService.StandaloneNext(db, ct);
            var generation = await db.ResourceGenerations.AsNoTracking().SingleOrDefaultAsync(ct) ?? new ResourceGeneration();
            var activeWorkout = await workouts.Active(ct);
            var nextId = active?.NextTemplateId ?? (next as NextWorkoutView)?.Id;
            return new
            {
                resourceVersions = ResourceVersions.For(generation, user.Unit),
                account = new { user.Id, displayName = user.DisplayName },
                preferences = new { user.Unit, user.Theme, user.RestSeconds, user.RestAlerts, user.TrackRir },
                activeWorkout, activeProgram = active, nextWorkout = next,
                workoutHero = await WorkoutHeroReadService.Get(db, nextId, activeWorkout, ct),
                imports = await imports.List(ct),
                gym = await GymProfiles.Launch(db, ct),
                navigationCounts = new { programs = await db.Programs.CountAsync(ct), templates = await db.Templates.CountAsync(x => x.ProgramId == null, ct) }
            };
        });
        app.MapGet("/api/history/summaries", async (DateTime? beforeAt, Guid? beforeId, int? size, AppDb db, CancellationToken ct)
            => await HistoryReadService.Get(db, beforeAt, beforeId, size ?? 20, ct));
    }
}
