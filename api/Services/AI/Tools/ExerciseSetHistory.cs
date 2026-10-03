using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services.AI.Tools;

/// Set-by-set history of one exercise for Ask AI. Each working set keeps its ordinal (set 1 is
/// compared with set 1), its prescription, the app's suggestion when the session started, and how
/// far the sets before it went past their target effort, so the model can tell carried-over
/// fatigue from lost strength exactly as the progression policy does.
internal sealed class ExerciseSetHistory(AppDb db, AiToolContext context)
{
    public sealed record SetRow(
        int Set, string? Technique, double? Weight, int? Reps, string? Rir, int? DurationSeconds, bool Done,
        string? Target, double? SuggestedWeight, int? SuggestedReps, string? SuggestionReason, double? EarlierSetsPastTargetBy);

    public sealed record SessionRow(string Date, string WorkoutId, List<SetRow> Sets);

    /// Completed sessions newest first, and whether older ones were left out. Suggestion reasons are
    /// kept only for the newest session to stay inside the tool-result bound; older sessions keep the
    /// suggested numbers.
    public async Task<(List<SessionRow> Sessions, bool More)> Completed(Guid? exerciseId, string name, int? setNumber, int limit, CancellationToken ct)
    {
        var lowered = name.ToLower();
        var rows = await (from exercise in db.SessionExercises.AsNoTracking()
                join session in db.Workouts.AsNoTracking() on exercise.SessionId equals session.Id
                where !session.Active && session.FinishedAt != null &&
                    // Matched the way progression keys history: by exercise when resolved, by name otherwise.
                    (exerciseId != null
                        ? exercise.ExerciseId == exerciseId
                        : exercise.ExerciseId == null && exercise.NameSnapshot.ToLower() == lowered)
                orderby session.FinishedAt descending, session.Id descending, exercise.Position
                select new { exercise.Id, exercise.SessionId, exercise.PrescriptionJson, session.FinishedAt })
            .Take(limit + 1).ToListAsync(ct);
        var more = rows.Count > limit;
        rows = rows.Take(limit).ToList();
        var sets = await Sets(rows.Select(row => row.Id).ToList(), doneOnly: true, ct);
        var sessions = rows.Select((row, index) => new SessionRow(
            context.LocalDate(row.FinishedAt!.Value).ToString("yyyy-MM-dd"), row.SessionId.ToString(),
            Describe(sets[row.Id], row.PrescriptionJson, setNumber, withReasons: index == 0))).ToList();
        return (sessions, more);
    }

    /// The exercise in the workout in progress, if any: its suggestions are the live recommendation.
    public async Task<SessionRow?> Active(Guid? exerciseId, string name, int? setNumber, CancellationToken ct)
    {
        var lowered = name.ToLower();
        var row = await (from exercise in db.SessionExercises.AsNoTracking()
                join session in db.Workouts.AsNoTracking() on exercise.SessionId equals session.Id
                where session.Active &&
                    (exerciseId != null
                        ? exercise.ExerciseId == exerciseId
                        : exercise.ExerciseId == null && exercise.NameSnapshot.ToLower() == lowered)
                orderby exercise.Position
                select new { exercise.Id, exercise.SessionId, exercise.PrescriptionJson, session.StartedAt })
            .FirstOrDefaultAsync(ct);
        if (row is null) return null;
        var sets = await Sets([row.Id], doneOnly: false, ct);
        return new SessionRow(context.LocalDate(row.StartedAt).ToString("yyyy-MM-dd"), row.SessionId.ToString(),
            Describe(sets[row.Id], row.PrescriptionJson, setNumber, withReasons: true));
    }

    private async Task<ILookup<Guid, CompletedSet>> Sets(List<Guid> exerciseIds, bool doneOnly, CancellationToken ct)
    {
        var sets = await db.Sets.AsNoTracking()
            .Where(set => exerciseIds.Contains(set.SessionExerciseId) && !set.Warmup && (!doneOnly || set.Done))
            .OrderBy(set => set.Position)
            .ToListAsync(ct);
        return sets.ToLookup(set => set.SessionExerciseId);
    }

    private List<SetRow> Describe(IEnumerable<CompletedSet> sets, string prescriptionJson, int? setNumber, bool withReasons)
    {
        var prescriptions = string.IsNullOrWhiteSpace(prescriptionJson) ? [] : Json.Read<List<SetPrescription>>(prescriptionJson);
        var earlier = new List<SetEffort>();
        var output = new List<SetRow>();
        var legacyOrdinal = 0;
        foreach (var set in sets)
        {
            var ordinal = set.WorkingSetOrdinal ?? ++legacyOrdinal;
            if (set.WorkingSetOrdinal is not null) legacyOrdinal = Math.Max(legacyOrdinal, ordinal);
            var prescription = prescriptions.ElementAtOrDefault(set.Position);
            var before = ProgressionFatigue.Before(earlier);
            // Only a logged set can have tired the ones after it.
            if (set.Done) earlier.Add(new SetEffort(set.Rir, set.Rpe, prescription?.Rir, prescription?.TargetRpe));
            if (setNumber is { } wanted && ordinal != wanted) continue;
            var suggestion = string.IsNullOrWhiteSpace(set.SuggestionJson) ? null : Json.Read<SetProgressionSuggestion>(set.SuggestionJson);
            output.Add(new SetRow(ordinal, SetTechniques.Of(prescription),
                AiToolUnits.Weight(set.WeightKg, context.WeightUnit), set.Reps,
                context.TrackRir ? set.Rir ?? ReserveText(set.Rpe) : null, set.DurationSeconds, set.Done,
                Target(prescription),
                AiToolUnits.Weight(suggestion?.SuggestedLoadKg, context.WeightUnit), suggestion?.SuggestedReps,
                withReasons ? suggestion?.Reason : null,
                context.TrackRir && before.Overshoot is >= 1 ? before.Overshoot : null));
        }
        return output;
    }

    private string? Target(SetPrescription? prescription)
    {
        if (prescription is null) return null;
        var reps = Progression.HasOpenReps(prescription.RepsText) ? "as many reps as possible"
            : prescription.RepMin is not { } min ? null
            : prescription.RepMax is { } max && max != min ? $"{min}-{max} reps" : $"{min} reps";
        var reserve = context.TrackRir ? ReserveTarget(prescription) : null;
        return (reps, reserve) switch
        {
            (null, null) => null,
            (null, _) => reserve,
            (_, null) => reps,
            _ => $"{reps} at {reserve}"
        };
    }

    private static string? ReserveTarget(SetPrescription prescription)
        => !string.IsNullOrWhiteSpace(prescription.Rir) ? $"{prescription.Rir} RIR"
            : prescription.TargetRpe is { } rpe ? $"RPE {rpe:0.#}" : null;

    private static string? ReserveText(double? rpe) => rpe is { } effort ? $"{Math.Max(0, 10 - effort):0.#}" : null;
}
