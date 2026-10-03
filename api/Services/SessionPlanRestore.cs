using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// One set after a restore: the existing row it reuses (null for a new row), the baseline snapshot
/// it follows (null for a logged set kept beyond the plan), and its new position.
public sealed record PlanRestoreStep(CompletedSet? Existing, BaselineSetSnapshot? Baseline, int Position);

public sealed record PlanRestoreResult(List<SetPrescription> Prescription, List<PlanRestoreStep> Sets, List<CompletedSet> Removed);

/// Putting a session exercise's plan back to the snapshot taken when the workout started, without
/// losing work: the set count, set types and targets return, an unlogged set returns to its start
/// values, and a logged set keeps what was lifted. A logged set beyond the plan stays as a straight
/// set; an unlogged one beyond it goes.
public static class SessionPlanRestore
{
    public static bool PlanDiffers(SessionExerciseBaseline baseline, string prescriptionJson, IReadOnlyCollection<CompletedSet> sets)
    {
        var planned = baseline.PlannedSets.OrderBy(set => set.Position).Select(set => set.Warmup).ToList();
        var current = sets.OrderBy(set => set.Position).Select(set => set.Warmup).ToList();
        if (!planned.SequenceEqual(current)) return true;
        return !ReadPlan(prescriptionJson).Select(Shape).SequenceEqual(ReadPlan(baseline.PrescriptionJson).Select(Shape));
    }

    public static PlanRestoreResult Apply(SessionExerciseBaseline baseline, IReadOnlyCollection<CompletedSet> sets)
    {
        var prescription = ReadPlan(baseline.PrescriptionJson);
        var planned = baseline.PlannedSets.OrderBy(set => set.Position).ToList();
        var current = sets.OrderBy(set => set.Position).ToList();
        var steps = planned.Select((snapshot, index) => new PlanRestoreStep(current.ElementAtOrDefault(index), snapshot, index)).ToList();
        var removed = new List<CompletedSet>();
        var straight = prescription.LastOrDefault(set => !set.Warmup) ?? prescription.LastOrDefault();
        foreach (var set in current.Skip(planned.Count))
        {
            if (!set.Done)
            {
                removed.Add(set);
                continue;
            }
            steps.Add(new PlanRestoreStep(set, null, steps.Count));
            prescription.Add(straight is null
                ? new SetPrescription(null, null, null, null, null, null, null, RepsSource: "userEdited", RpeSource: "userEdited", RestSource: "userEdited")
                : straight with { Notes = null, Warmup = false });
        }
        return new PlanRestoreResult(prescription, steps, removed);
    }

    /// Writes a restore result onto the exercise's set rows. Returns the rows that now exist, in order.
    public static List<CompletedSet> ApplyTo(PlanRestoreResult result, Guid userId, Guid sessionExerciseId, Action<CompletedSet> add)
    {
        var rows = new List<CompletedSet>();
        foreach (var step in result.Sets)
        {
            var row = step.Existing;
            if (row is null)
            {
                row = new CompletedSet { UserId = userId, SessionExerciseId = sessionExerciseId };
                add(row);
            }
            row.Position = step.Position;
            if (row.Done)
            {
                // Lifted numbers stay; only the set's type follows the plan, and a warm-up keeps no effort.
                row.Warmup = step.Baseline?.Warmup ?? false;
                if (row.Warmup) { row.Rpe = null; row.Rir = null; }
            }
            else if (step.Baseline is { } snapshot)
            {
                row.WeightKg = snapshot.WeightKg;
                row.Reps = snapshot.Reps;
                row.DurationSeconds = null;
                row.Rpe = snapshot.Rpe;
                row.Rir = null;
                row.Warmup = snapshot.Warmup;
                row.SuggestionJson = snapshot.SuggestionJson;
                row.ResistanceMode = snapshot.ResistanceMode;
                row.SystemLoadKg = snapshot.SystemLoadKg;
            }
            rows.Add(row);
        }
        var ordinal = 0;
        foreach (var row in rows) row.WorkingSetOrdinal = row.Warmup ? null : ++ordinal;
        return rows;
    }

    private static List<SetPrescription> ReadPlan(string json)
        => string.IsNullOrWhiteSpace(json) ? [] : Json.Read<List<SetPrescription>>(json) ?? [];

    private static (bool Warmup, string? Technique, int? RepMin, int? RepMax, double? TargetRpe, string? Rir, int? RestSeconds) Shape(SetPrescription set)
        => (set.Warmup, SetTechniques.Of(set), set.RepMin, set.RepMax, set.TargetRpe, set.Rir, set.RestSeconds);
}
