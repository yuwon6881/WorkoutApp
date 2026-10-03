using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services.AI.Tools;

public sealed class GetActiveWorkoutTool : IAiTool
{
    private readonly AppDb _db;

    public GetActiveWorkoutTool(AppDb db)
    {
        _db = db;
    }

    public string Name => "get_active_workout";
    public string Description => "Get the status and details of the user's currently active workout session, if one is in progress.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject()
    };

    public string ProgressLabel(AiToolArgs args) => "Checking active workout in progress...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var activeWorkout = await _db.Workouts.AsNoTracking()
            .Where(w => w.Active)
            .FirstOrDefaultAsync(cancellationToken);

        if (activeWorkout == null)
        {
            return AiToolResult.Of(new
            {
                hasActiveWorkout = false,
                message = "There is no workout session currently in progress."
            });
        }

        context.Evidence.Record(AiEvidenceLedger.Workout, activeWorkout.Id.ToString());

        var exercises = await _db.SessionExercises.AsNoTracking()
            .Where(e => e.SessionId == activeWorkout.Id)
            .OrderBy(e => e.Position)
            .ToListAsync(cancellationToken);

        var seIds = exercises.Select(e => e.Id).ToList();
        var sets = await _db.Sets.AsNoTracking()
            .Where(s => seIds.Contains(s.SessionExerciseId))
            .OrderBy(s => s.Position)
            .ToListAsync(cancellationToken);

        var setsByExercise = sets.GroupBy(s => s.SessionExerciseId)
            .ToDictionary(g => g.Key, g => g.ToList());

        foreach (var e in exercises)
        {
            if (e.ExerciseId.HasValue)
                context.Evidence.Record(AiEvidenceLedger.Exercise, e.ExerciseId.Value.ToString());
        }

        var exercisesOutput = exercises.Select(e =>
        {
            var exerciseSets = setsByExercise.GetValueOrDefault(e.Id, []);
            var doneCount = exerciseSets.Count(s => s.Done);
            return new
            {
                exerciseId = e.ExerciseId?.ToString(),
                name = e.NameSnapshot,
                totalSets = exerciseSets.Count,
                completedSets = doneCount,
                sets = exerciseSets.Select(s =>
                {
                    // The suggestion fixed when the session started is the live recommendation for that set.
                    var suggestion = string.IsNullOrWhiteSpace(s.SuggestionJson)
                        ? null : Json.Read<SetProgressionSuggestion>(s.SuggestionJson);
                    return new
                    {
                        setNumber = s.Position + 1,
                        workingSet = s.WorkingSetOrdinal,
                        warmup = s.Warmup,
                        done = s.Done,
                        weight = AiToolUnits.Weight(s.WeightKg, context.WeightUnit),
                        reps = s.Reps,
                        rir = context.TrackRir ? s.Rir : null,
                        durationSeconds = s.DurationSeconds,
                        suggestedWeight = AiToolUnits.Weight(suggestion?.SuggestedLoadKg, context.WeightUnit),
                        suggestedReps = suggestion?.SuggestedReps,
                        suggestionReason = suggestion?.Reason
                    };
                }).ToList()
            };
        }).ToList();

        var elapsedMinutes = (int)Math.Max(0,
            ((activeWorkout.PausedAt ?? DateTime.UtcNow) - activeWorkout.StartedAt).TotalMinutes - activeWorkout.PausedSeconds / 60.0);

        return AiToolResult.Of(new
        {
            hasActiveWorkout = true,
            weightUnit = context.WeightUnit,
            workoutId = activeWorkout.Id.ToString(),
            name = activeWorkout.Name,
            startedAt = activeWorkout.StartedAt.ToString("o"),
            elapsedMinutes,
            restStatus = activeWorkout.RestStatus,
            exercises = exercisesOutput
        });
    }
}
