using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

public sealed class GoogleHealthWorkoutSummaryService(AppDb db)
{
    public async Task<string> BuildSummaryNotesAsync(Guid sessionId, CancellationToken ct)
    {
        var session = await db.Workouts.AsNoTracking().SingleOrDefaultAsync(w => w.Id == sessionId, ct);
        var exercises = await db.SessionExercises.AsNoTracking()
            .Where(e => e.SessionId == sessionId)
            .OrderBy(e => e.Position)
            .ToListAsync(ct);

        var exerciseIds = exercises.Select(e => e.Id).ToList();
        var sets = await db.Sets.AsNoTracking()
            .Where(s => exerciseIds.Contains(s.SessionExerciseId) && s.Done)
            .OrderBy(s => s.Position)
            .ToListAsync(ct);

        var lines = new List<string>();
        double totalVolume = 0;
        int completedSetCount = 0;

        foreach (var exercise in exercises)
        {
            var exerciseSets = sets.Where(set => set.SessionExerciseId == exercise.Id).ToList();
            if (exerciseSets.Count == 0) continue;

            var setSummaries = new List<string>();
            foreach (var set in exerciseSets)
            {
                completedSetCount++;
                if (!set.Warmup && set.WeightKg.HasValue && set.Reps.HasValue)
                {
                    totalVolume += set.WeightKg.Value * set.Reps.Value;
                }

                if (set.WeightKg.HasValue && set.Reps.HasValue)
                    setSummaries.Add($"{set.WeightKg.Value:0.#}kg x {set.Reps.Value}");
                else if (set.Reps.HasValue)
                    setSummaries.Add($"{set.Reps.Value} reps");
                else
                    setSummaries.Add("1 set");
            }

            var name = string.IsNullOrWhiteSpace(exercise.NameSnapshot) ? "Exercise" : exercise.NameSnapshot;
            lines.Add($"{name}: {exerciseSets.Count} sets ({string.Join(", ", setSummaries)})");
        }

        if (completedSetCount > 0)
        {
            lines.Add($"Total Volume: {totalVolume:N0} kg | {completedSetCount} completed sets");
        }

        if (session != null && !string.IsNullOrWhiteSpace(session.Note))
        {
            lines.Add($"Note: {session.Note.Trim()}");
        }

        return string.Join("\n", lines);
    }
}
