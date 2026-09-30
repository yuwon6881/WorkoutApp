using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Services.AI.Tools;

public sealed class GetExerciseProgressTool : IAiTool
{
    private readonly AppDb _db;

    public GetExerciseProgressTool(AppDb db)
    {
        _db = db;
    }

    public string Name => "get_exercise_progress";
    public string Description => "Get strength progression, estimated 1RM trends, personal records, and recent performance history for an exercise.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["exercise"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "The exercise name or slug (e.g., 'Bench Press', 'barbell-bench-press')."
            }
        },
        ["required"] = new JsonArray("exercise")
    };

    public string ProgressLabel(AiToolArgs args) =>
        $"Checking progress for {args.OptionalString("exercise") ?? "exercise"}...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var input = args.RequiredString("exercise", 160).Trim();
        var normalized = CatalogService.Normalize(input);

        // Try to match catalog exercise by slug or name
        var catalogEx = await _db.Exercises.AsNoTracking()
            .Where(e => e.Slug == input.ToLowerInvariant() || e.Name.ToLower() == input.ToLower())
            .FirstOrDefaultAsync(cancellationToken);

        if (catalogEx == null)
        {
            // Try alias
            var alias = await _db.Aliases.AsNoTracking()
                .Where(a => a.Normalized == normalized)
                .FirstOrDefaultAsync(cancellationToken);
            if (alias != null)
            {
                catalogEx = await _db.Exercises.AsNoTracking()
                    .FirstOrDefaultAsync(e => e.Id == alias.ExerciseId, cancellationToken);
            }
        }

        CustomExercise? customEx = null;
        if (catalogEx == null)
        {
            var customId = input.StartsWith("custom-", StringComparison.OrdinalIgnoreCase)
                && Guid.TryParse(input[7..], out var parsedId) ? parsedId : Guid.Empty;
            customEx = await _db.CustomExercises.AsNoTracking()
                .Where(c => (c.Id == customId || c.Name.ToLower() == input.ToLower()) && !c.Archived)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var exerciseId = catalogEx?.Id ?? customEx?.Id;
        var exerciseName = catalogEx?.Name ?? customEx?.Name ?? input;
        var slug = catalogEx?.Slug ?? (customEx == null ? normalized : $"custom-{customEx.Id:N}");

        if (exerciseId.HasValue)
        {
            context.Evidence.Record(AiEvidenceLedger.Exercise, exerciseId.Value.ToString());
        }
        if (exerciseId.HasValue) context.Evidence.Record(AiEvidenceLedger.Exercise, slug);

        // Find progress row
        ExerciseProgress? progress = null;
        if (exerciseId.HasValue)
        {
            progress = await _db.Progress.AsNoTracking()
                .FirstOrDefaultAsync(p => p.ExerciseId == exerciseId.Value && p.NameKey == "", cancellationToken);
        }
        if (progress == null)
        {
            progress = await _db.Progress.AsNoTracking()
                .FirstOrDefaultAsync(p => p.ExerciseId == Guid.Empty && p.NameKey == normalized, cancellationToken);
        }

        // Query recent session sets for this exercise (last 10 sessions where it was performed)
        var completedSessions = _db.Workouts.AsNoTracking().Where(w => !w.Active && w.FinishedAt != null);
        var recentSetsQuery = (from se in _db.SessionExercises.AsNoTracking()
            join session in completedSessions on se.SessionId equals session.Id
            where (exerciseId != null && se.ExerciseId == exerciseId) || se.NameSnapshot.ToLower() == exerciseName.ToLower()
            orderby session.FinishedAt descending, session.Id descending, se.Position
            select se).Take(10);

        var recentSes = await recentSetsQuery.ToListAsync(cancellationToken);
        var recentSeIds = recentSes.Select(se => se.Id).ToList();
        var sessionIds = recentSes.Select(se => se.SessionId).Distinct().ToList();

        var sessions = await _db.Workouts.AsNoTracking()
            .Where(w => sessionIds.Contains(w.Id) && w.FinishedAt != null)
            .ToDictionaryAsync(w => w.Id, w => w.FinishedAt!.Value, cancellationToken);

        var doneSets = await _db.Sets.AsNoTracking()
            .Where(s => recentSeIds.Contains(s.SessionExerciseId) && s.Done && !s.Warmup)
            .OrderByDescending(s => s.WeightKg)
            .ToListAsync(cancellationToken);

        var historyBySession = recentSes
            .Where(se => sessions.ContainsKey(se.SessionId))
            .Select(se =>
            {
                var sets = doneSets.Where(s => s.SessionExerciseId == se.Id).ToList();
                var bestSet = sets.OrderByDescending(s => (s.WeightKg ?? 0) * (s.Reps ?? 0)).FirstOrDefault();
                return new
                {
                    date = context.LocalDate(sessions[se.SessionId]).ToString("yyyy-MM-dd"),
                    completedSets = sets.Count,
                    topWeight = bestSet == null ? null : ConvertWeight(bestSet.WeightKg, context.WeightUnit),
                    topReps = bestSet?.Reps,
                    topRir = context.TrackRir ? bestSet?.Rir : null,
                    topDurationSeconds = bestSet?.DurationSeconds
                };
            })
            .OrderByDescending(h => h.date)
            .Take(5)
            .ToList();

        return AiToolResult.Of(new
        {
            exercise = exerciseName,
            slug,
            muscle = catalogEx?.Muscle ?? customEx?.Muscle ?? "Unknown",
            weightUnit = context.WeightUnit,
            progression = progress == null ? null : new
            {
                trendE1rm = ConvertWeight(progress.TrendE1rmKg, context.WeightUnit),
                lastE1rm = ConvertWeight(progress.LastE1rmKg, context.WeightUnit),
                stalls = progress.Stalls
            },
            recentExposures = historyBySession
        });
    }

    private static double? ConvertWeight(double? weightKg, string unit)
    {
        if (!weightKg.HasValue) return null;
        if (unit.Equals("lb", StringComparison.OrdinalIgnoreCase))
            return Math.Round(weightKg.Value * 2.20462, 1);
        return Math.Round(weightKg.Value, 1);
    }
}
