using Microsoft.EntityFrameworkCore;

namespace Workout.Api.Data;

internal static class ResourceGenerationWriter
{
    public static async Task<List<ResourceGeneration>> Changes(AppDb db, CancellationToken ct)
    {
        var entries = db.ChangeTracker.Entries()
            .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted).ToList();
        var users = entries.Select(e => e.Entity is OwnedRecord owned ? owned.UserId
            : e.Entity is AppUser user ? user.Id : (Guid?)null).OfType<Guid>().Distinct();
        var output = new List<ResourceGeneration>();
        foreach (var user in users)
        {
            var changed = entries.Where(e => e.Entity is OwnedRecord owned && owned.UserId == user
                || e.Entity is AppUser account && account.Id == user).ToList();
            bool Has<T>() => changed.Any(e => e.Entity is T);
            var history = changed.Any(e => e.Entity is WorkoutSession workout &&
                (workout.FinishedAt != null || e.OriginalValues.GetValue<DateTime?>(nameof(WorkoutSession.FinishedAt)) != null));
            if (!history && (Has<CompletedSet>() || Has<SessionExercise>()))
            {
                var exerciseIds = changed.Where(e => e.Entity is CompletedSet)
                    .Select(e => ((CompletedSet)e.Entity).SessionExerciseId).ToList();
                var sessionIds = changed.Where(e => e.Entity is SessionExercise)
                    .Select(e => ((SessionExercise)e.Entity).SessionId).ToList();
                foreach (var exercise in db.ChangeTracker.Entries<SessionExercise>().Where(x => exerciseIds.Contains(x.Entity.Id)))
                    sessionIds.Add(exercise.Entity.SessionId);
                var parents = db.ChangeTracker.Entries<WorkoutSession>().Where(x => sessionIds.Contains(x.Entity.Id)).ToList();
                var allParentsKnownActive = sessionIds.Count > 0 && parents.Count == sessionIds.Distinct().Count() &&
                    parents.All(x => x.Entity.FinishedAt == null) && exerciseIds.All(id => db.ChangeTracker.Entries<SessionExercise>().Any(x => x.Entity.Id == id));
                // Resolve untracked parents before deleted sets/exercises disappear. Normal
                // active-set patches already loaded their parent and need no extra query.
                history = !allParentsKnownActive && await (from workout in db.Workouts.IgnoreQueryFilters()
                    where workout.UserId == user && workout.FinishedAt != null
                    where sessionIds.Contains(workout.Id) || db.SessionExercises.IgnoreQueryFilters()
                        .Any(exercise => exercise.UserId == user && exercise.SessionId == workout.Id && exerciseIds.Contains(exercise.Id))
                    select workout.Id).AnyAsync(ct);
            }
            var completed = changed.Where(e => e.Entity is WorkoutSession workout && workout.FinishedAt != null).ToList();
            var appendId = completed.Count == 1 && completed[0].State != EntityState.Deleted &&
                (completed[0].State == EntityState.Added || completed[0].OriginalValues.GetValue<DateTime?>(nameof(WorkoutSession.FinishedAt)) == null)
                ? ((WorkoutSession)completed[0].Entity).Id : (Guid?)null;
            var generation = new ResourceGeneration
            {
                UserId = user,
                Programs = Has<TrainingProgram>() || Has<ProgramPhase>() || Has<ProgramRun>() || Has<ProgramDayProgress>() || Has<ProgramSkip>() ? 1 : 0,
                Templates = Has<WorkoutTemplate>() || Has<TemplateExercise>() ? 1 : 0,
                Sessions = Has<WorkoutSession>() || Has<SessionExercise>() || Has<CompletedSet>() ? 1 : 0,
                Imports = Has<AiImport>() ? 1 : 0,
                Progress = history || Has<ExerciseProgress>() ? 1 : 0,
                History = history ? 1 : 0,
                HistoryAppendId = appendId,
                CustomExercises = Has<CustomExercise>() ? 1 : 0,
                ExerciseLoads = Has<ExerciseLoadSetting>() ? 1 : 0,
                Preferences = Has<AppUser>() ? 1 : 0
            };
            if (generation.Programs + generation.Templates + generation.Sessions + generation.Imports + generation.Progress
                + generation.CustomExercises + generation.ExerciseLoads + generation.Preferences + generation.History > 0)
                output.Add(generation);
        }
        return output;
    }

    public static async Task Write(AppDb db, ResourceGeneration g, CancellationToken ct)
    {
        // Atomic increments avoid losing another request's update; the surrounding source
        // transaction ensures a cache can never observe an uncommitted generation.
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "ResourceGenerations" ("UserId", "Programs", "Templates", "Sessions", "Imports", "Progress", "CustomExercises", "ExerciseLoads", "Preferences", "History", "HistoryAppendId")
            VALUES ({g.UserId}, {g.Programs}, {g.Templates}, {g.Sessions}, {g.Imports}, {g.Progress}, {g.CustomExercises}, {g.ExerciseLoads}, {g.Preferences}, {g.History}, {g.HistoryAppendId})
            ON CONFLICT ("UserId") DO UPDATE SET
            "Programs" = "ResourceGenerations"."Programs" + {g.Programs},
            "Templates" = "ResourceGenerations"."Templates" + {g.Templates},
            "Sessions" = "ResourceGenerations"."Sessions" + {g.Sessions},
            "Imports" = "ResourceGenerations"."Imports" + {g.Imports},
            "Progress" = "ResourceGenerations"."Progress" + {g.Progress},
            "CustomExercises" = "ResourceGenerations"."CustomExercises" + {g.CustomExercises},
            "ExerciseLoads" = "ResourceGenerations"."ExerciseLoads" + {g.ExerciseLoads},
            "Preferences" = "ResourceGenerations"."Preferences" + {g.Preferences},
            "History" = "ResourceGenerations"."History" + {g.History},
            "HistoryAppendId" = CASE WHEN {g.History} = 1 THEN {g.HistoryAppendId} ELSE "ResourceGenerations"."HistoryAppendId" END
            """, ct);
    }
}
