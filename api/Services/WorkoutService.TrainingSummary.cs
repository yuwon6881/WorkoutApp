using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
namespace Workout.Api.Services;
public sealed partial class WorkoutService
{
    public async Task<List<WorkoutTrainingSummary>> TrainingSummary(DateOnly? from, DateOnly? to, string? timeZone, CancellationToken ct)
    {
        var zone = string.IsNullOrWhiteSpace(timeZone) ? TimeZoneInfo.Utc : SafeZone(timeZone.Trim());
        var todayLocal = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        var start = from ?? todayLocal.AddDays(-30);
        var end = to ?? todayLocal;
        Validation.Require(start <= end && end.DayNumber - start.DayNumber <= 366, "Choose a date range of one year or less.");

        var startUtc = start.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(-1);
        var endUtc = end.AddDays(2).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        var rows = await db.Workouts.AsNoTracking().Where(w =>
            (w.FinishedAt != null && w.FinishedAt >= startUtc && w.FinishedAt < endUtc) ||
            (w.Active && w.StartedAt >= startUtc && w.StartedAt < endUtc))
            .OrderBy(w => w.StartedAt).Select(w => new { w.Id, w.Name, w.StartedAt, w.FinishedAt, w.Active }).ToListAsync(ct);

        var sessionIds = rows.Select(session => session.Id).ToList();
        var exercises = await db.SessionExercises.AsNoTracking().Where(exercise => sessionIds.Contains(exercise.SessionId))
            .Select(exercise => new SessionExercise { Id = exercise.Id, SessionId = exercise.SessionId, ExerciseId = exercise.ExerciseId, LoadModel = exercise.LoadModel }).ToListAsync(ct);
        var exerciseIdsForSets = exercises.Select(exercise => exercise.Id).ToList();
        var allSets = await db.Sets.AsNoTracking().Where(set => exerciseIdsForSets.Contains(set.SessionExerciseId) && set.Done && !set.Warmup)
            .Select(set => new CompletedSet { SessionExerciseId = set.SessionExerciseId, Done = set.Done, Warmup = set.Warmup,
                WeightKg = set.WeightKg, SystemLoadKg = set.SystemLoadKg, Reps = set.Reps, Rpe = set.Rpe }).ToListAsync(ct);
        var bySession = exercises.ToLookup(exercise => exercise.SessionId);
        var byExercise = allSets.ToLookup(set => set.SessionExerciseId);
        var muscleIds = exercises.Where(e => e.ExerciseId is not null)
            .Select(e => e.ExerciseId!.Value).Distinct().ToList();
        var musclesById = await catalog.MusclesFor(muscleIds, ct);
        var result = new List<WorkoutTrainingSummary>();

        foreach (var session in rows)
        {
            var localDateTime = TimeZoneInfo.ConvertTimeFromUtc(session.StartedAt, zone);
            var actualDate = DateOnly.FromDateTime(localDateTime);
            if (actualDate < start || actualDate > end) continue;

            var sessionExercises = bySession[session.Id].ToList();
            var sets = sessionExercises.SelectMany(exercise => byExercise[exercise.Id]).ToList();
            var volume = WorkoutAccounting.Volume(sessionExercises, sets);
            var rpes = sets.Where(s => s.Rpe is not null).Select(s => s.Rpe!.Value).ToList();
            var exerciseIds = sessionExercises.Where(e => e.ExerciseId is not null).Select(e => e.ExerciseId!.Value).Distinct().ToList();
            var muscles = exerciseIds.Select(id => musclesById.GetValueOrDefault(id, ""))
                .Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().OrderBy(x => x).ToList();
            var status = session.Active ? "in_progress" : "completed";
            result.Add(new WorkoutTrainingSummary($"session:{session.Id}", status, actualDate, session.StartedAt, session.FinishedAt,
                session.Name, muscles, sets.Count, volume.External, volume.System, rpes.Count == 0 ? null : rpes.Average(), !session.Active, actualDate));
        }
        result.Sort((left, right) => left.LocalDate.CompareTo(right.LocalDate));
        return result;
    }

}
