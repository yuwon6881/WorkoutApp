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

    private const int SessionLimit = 5;
    private const int FocusedSessionLimit = 10;
    private const int MaxSetNumber = 20;

    private const string HowToRead =
        "set is the working-set number; compare a set only with the same set in other sessions. " +
        "suggestedWeight/suggestedReps are what the app recommended when that session started, and suggestionReason explains why. " +
        "earlierSetsPastTargetBy is how many reps closer to failure than prescribed an earlier set of the same exercise went in that session; " +
        "a lower result on a later set after that is carried-over fatigue, not lost strength. " +
        "The next recommendation is calculated when the next workout starts.";

    public string Name => "get_exercise_progress";
    public string Description =>
        "Get the progression of one exercise set by set: each working set's weight, reps, and RIR across recent sessions, " +
        "its target, the app's suggestion and reason, effort carried over from earlier sets, the live suggestion in a workout " +
        "in progress, and the estimated 1RM trend. Pass setNumber to focus on one working set across more sessions.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["exercise"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "The exercise name or slug (e.g., 'Bench Press', 'barbell-bench-press')."
            },
            ["setNumber"] = new JsonObject
            {
                ["type"] = "integer",
                ["minimum"] = 1,
                ["maximum"] = MaxSetNumber,
                ["description"] = "Optional working-set number (1 = first working set) to follow one set across sessions."
            }
        },
        ["required"] = new JsonArray("exercise")
    };

    public string ProgressLabel(AiToolArgs args) =>
        $"Checking progress for {args.OptionalString("exercise") ?? "exercise"}...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var input = args.RequiredString("exercise", 160).Trim();
        var setNumber = args.OptionalInt("setNumber", 1, MaxSetNumber);
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

        var history = new ExerciseSetHistory(_db, context);
        var (sessions, more) = await history.Completed(exerciseId, exerciseName, setNumber,
            setNumber is null ? SessionLimit : FocusedSessionLimit, cancellationToken);
        var current = await history.Active(exerciseId, exerciseName, setNumber, cancellationToken);
        context.Evidence.RecordAll(AiEvidenceLedger.Workout, sessions.Select(session => session.WorkoutId));
        if (current != null) context.Evidence.Record(AiEvidenceLedger.Workout, current.WorkoutId);

        return AiToolResult.Of(new
        {
            exercise = exerciseName,
            slug,
            muscle = catalogEx?.Muscle ?? customEx?.Muscle ?? "Unknown",
            weightUnit = context.WeightUnit,
            rirTracked = context.TrackRir,
            setNumber,
            progression = progress == null ? null : new
            {
                trendE1rm = AiToolUnits.Weight(progress.TrendE1rmKg, context.WeightUnit),
                lastE1rm = AiToolUnits.Weight(progress.LastE1rmKg, context.WeightUnit),
                sessionsBelowTrend = progress.Stalls
            },
            sessions,
            currentWorkout = current,
            howToRead = HowToRead
        }, truncated: more);
    }
}
