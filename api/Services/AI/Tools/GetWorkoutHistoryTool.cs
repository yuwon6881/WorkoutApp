using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services.AI.Tools;

public sealed class GetWorkoutHistoryTool : IAiTool
{
    private readonly AppDb _db;

    public GetWorkoutHistoryTool(AppDb db)
    {
        _db = db;
    }

    public string Name => "get_workout_history";
    public string Description => "Get recent completed workouts, filtered and dated by completion in local time, with start date, duration, and exercise summary.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["limit"] = new JsonObject
            {
                ["type"] = "integer",
                ["description"] = "Number of recent workouts to return (1-20, default 5)."
            },
            ["fromDate"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "Optional start date in yyyy-MM-dd format."
            },
            ["toDate"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "Optional end date in yyyy-MM-dd format."
            }
        }
    };

    public string ProgressLabel(AiToolArgs args) => "Looking up your workout history...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var limit = args.OptionalInt("limit", 1, 20) ?? 5;
        var fromDate = args.OptionalDate("fromDate");
        var toDate = args.OptionalDate("toDate");
        if (fromDate > toDate) throw new AiToolArgumentException("fromDate must not be after toDate.");

        var query = _db.Workouts.AsNoTracking()
            .Where(w => !w.Active && w.FinishedAt != null);

        if (fromDate.HasValue)
        {
            var startUtc = context.DayStartUtc(fromDate.Value);
            query = query.Where(w => w.FinishedAt >= startUtc);
        }
        if (toDate.HasValue)
        {
            var endUtc = context.DayStartUtc(toDate.Value.AddDays(1));
            query = query.Where(w => w.FinishedAt < endUtc);
        }

        var totalMatches = await query.CountAsync(cancellationToken);
        var workouts = await query
            .OrderByDescending(w => w.FinishedAt).ThenByDescending(w => w.Id)
            .Take(limit)
            .Select(w => new
            {
                w.Id,
                w.Name,
                w.StartedAt,
                w.FinishedAt,
                w.PausedSeconds
            })
            .ToListAsync(cancellationToken);

        if (workouts.Count == 0)
        {
            return AiToolResult.Of(new { workouts = Array.Empty<object>(), message = "No completed workouts found." });
        }

        var workoutIds = workouts.Select(w => w.Id).ToList();
        context.Evidence.RecordAll(AiEvidenceLedger.Workout, workoutIds.Select(id => id.ToString()));

        var exercises = await _db.SessionExercises.AsNoTracking()
            .Where(e => workoutIds.Contains(e.SessionId))
            .OrderBy(e => e.Position)
            .Select(e => new
            {
                e.Id,
                e.SessionId,
                e.ExerciseId,
                e.NameSnapshot,
                e.Position
            })
            .ToListAsync(cancellationToken);

        var sessionExerciseIds = exercises.Select(e => e.Id).ToList();
        var sets = await _db.Sets.AsNoTracking()
            .Where(s => sessionExerciseIds.Contains(s.SessionExerciseId) && s.Done && !s.Warmup)
            .Select(s => new
            {
                s.SessionExerciseId,
                s.WeightKg,
                s.Reps,
                s.Rir,
                s.Rpe,
                s.DurationSeconds
            })
            .ToListAsync(cancellationToken);

        var setsByExercise = sets.GroupBy(s => s.SessionExerciseId)
            .ToDictionary(g => g.Key, g => g.ToList());
        var exercisesBySession = exercises.GroupBy(e => e.SessionId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var result = workouts.Select(w =>
        {
            var sessionExercises = exercisesBySession.GetValueOrDefault(w.Id, []);
            var exerciseSummaries = sessionExercises.Select(e =>
            {
                var doneSets = setsByExercise.GetValueOrDefault(e.Id, []);
                var topSet = doneSets
                    .OrderByDescending(s => (s.WeightKg ?? 0) * (s.Reps ?? 0))
                    .FirstOrDefault();

                return new
                {
                    name = e.NameSnapshot,
                    completedSets = doneSets.Count,
                    topSet = topSet == null ? null : new
                    {
                        weight = ConvertWeight(topSet.WeightKg, context.WeightUnit),
                        reps = topSet.Reps,
                        rir = context.TrackRir ? topSet.Rir : null,
                        rpe = context.TrackRir ? topSet.Rpe : null,
                        durationSeconds = topSet.DurationSeconds
                    }
                };
            }).ToList();

            var durationMinutes = w.FinishedAt.HasValue
                ? Math.Max(0, (int)Math.Round((w.FinishedAt.Value - w.StartedAt).TotalMinutes - (w.PausedSeconds / 60.0)))
                : 0;

            return new
            {
                workoutId = w.Id.ToString(),
                name = w.Name,
                date = context.LocalDate(w.FinishedAt!.Value).ToString("yyyy-MM-dd"),
                startedDate = context.LocalDate(w.StartedAt).ToString("yyyy-MM-dd"),
                durationMinutes,
                exerciseCount = sessionExercises.Count,
                exercises = exerciseSummaries
            };
        }).ToList();

        return AiToolResult.Of(new
        {
            weightUnit = context.WeightUnit,
            totalMatches,
            count = result.Count,
            workouts = result
        }, truncated: totalMatches > limit);
    }

    private static double? ConvertWeight(double? weightKg, string unit)
    {
        if (!weightKg.HasValue) return null;
        if (unit.Equals("lb", StringComparison.OrdinalIgnoreCase))
            return Math.Round(weightKg.Value * 2.20462, 1);
        return Math.Round(weightKg.Value, 1);
    }
}
