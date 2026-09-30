using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services.AI.Tools;

public sealed class GetWorkoutDetailTool : IAiTool
{
    private readonly AppDb _db;

    public GetWorkoutDetailTool(AppDb db)
    {
        _db = db;
    }

    public string Name => "get_workout_detail";
    public string Description => "Get full details of a specific workout session, including all exercises and individual sets (weight, reps, RIR/RPE).";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["workoutId"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "The GUID of the workout session to inspect."
            }
        },
        ["required"] = new JsonArray("workoutId")
    };

    public string ProgressLabel(AiToolArgs args) => "Loading workout details...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var workoutIdStr = args.RequiredString("workoutId", 40);
        if (!Guid.TryParse(workoutIdStr, out var workoutId))
            throw new AiToolArgumentException("workoutId must be a valid GUID.");

        var workout = await _db.Workouts.AsNoTracking()
            .FirstOrDefaultAsync(w => w.Id == workoutId, cancellationToken);

        if (workout == null)
            return AiToolResult.Of(new { found = false, message = $"Workout '{workoutIdStr}' was not found." });

        context.Evidence.Record(AiEvidenceLedger.Workout, workout.Id.ToString());

        var sessionExercises = await _db.SessionExercises.AsNoTracking()
            .Where(e => e.SessionId == workout.Id)
            .OrderBy(e => e.Position)
            .ToListAsync(cancellationToken);

        var seIds = sessionExercises.Select(e => e.Id).ToList();
        var allSets = await _db.Sets.AsNoTracking()
            .Where(s => seIds.Contains(s.SessionExerciseId))
            .OrderBy(s => s.Position)
            .ToListAsync(cancellationToken);

        var setsByExercise = allSets.GroupBy(s => s.SessionExerciseId)
            .ToDictionary(g => g.Key, g => g.ToList());

        // Evidence recording for exercises
        foreach (var se in sessionExercises)
        {
            if (se.ExerciseId.HasValue)
                context.Evidence.Record(AiEvidenceLedger.Exercise, se.ExerciseId.Value.ToString());
        }

        var exercisesOutput = sessionExercises.Select(se =>
        {
            var sets = setsByExercise.GetValueOrDefault(se.Id, []);
            return new
            {
                exerciseId = se.ExerciseId?.ToString(),
                name = se.NameSnapshot,
                note = se.Note,
                sets = sets.Select(s => new
                {
                    setNumber = s.Position + 1,
                    done = s.Done,
                    warmup = s.Warmup,
                    weight = ConvertWeight(s.WeightKg, context.WeightUnit),
                    reps = s.Reps,
                    rir = context.TrackRir ? s.Rir : null,
                    rpe = context.TrackRir ? s.Rpe : null,
                    durationSeconds = s.DurationSeconds
                }).ToList()
            };
        }).ToList();

        var durationMinutes = workout.FinishedAt.HasValue
            ? Math.Max(0, (int)Math.Round((workout.FinishedAt.Value - workout.StartedAt).TotalMinutes - (workout.PausedSeconds / 60.0)))
            : 0;

        return AiToolResult.Of(new
        {
            found = true,
            workoutId = workout.Id.ToString(),
            name = workout.Name,
            status = workout.Active ? "In Progress" : "Completed",
            startedAt = workout.StartedAt.ToString("yyyy-MM-dd HH:mm UTC"),
            finishedAt = workout.FinishedAt?.ToString("yyyy-MM-dd HH:mm UTC"),
            durationMinutes,
            weightUnit = context.WeightUnit,
            exercises = exercisesOutput
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
