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
        var pairs = current.Count < planned.Count ? AlignByType(planned, current) : null;
        var steps = new List<PlanRestoreStep>();
        var removed = new List<CompletedSet>();
        var straight = prescription.LastOrDefault(set => !set.Warmup) ?? prescription.LastOrDefault();

        void KeepBeyondPlan(CompletedSet set)
        {
            if (!set.Done)
            {
                removed.Add(set);
                return;
            }
            prescription.Insert(Math.Min(steps.Count, prescription.Count), straight is null
                ? new SetPrescription(null, null, null, null, null, null, null, RepsSource: "userEdited", RpeSource: "userEdited", RestSource: "userEdited")
                : straight with { Notes = null, Warmup = false });
            steps.Add(new PlanRestoreStep(set, null, steps.Count));
        }

        if (pairs is null)
        {
            for (var index = 0; index < planned.Count; index++)
                steps.Add(new PlanRestoreStep(current.ElementAtOrDefault(index), planned[index], index));
            foreach (var set in current.Skip(planned.Count)) KeepBeyondPlan(set);
        }
        else
        {
            // Sets were removed, so position no longer says which plan slot a row belongs to: a planned
            // slot nothing matches comes back as a fresh row rather than taking over a logged one.
            var nextPlanned = 0;
            var nextCurrent = 0;
            foreach (var (plannedAt, currentAt) in pairs.Append((planned.Count, current.Count)))
            {
                for (; nextPlanned < plannedAt; nextPlanned++)
                    steps.Add(new PlanRestoreStep(null, planned[nextPlanned], steps.Count));
                for (; nextCurrent < currentAt; nextCurrent++) KeepBeyondPlan(current[nextCurrent]);
                if (plannedAt == planned.Count) break;
                steps.Add(new PlanRestoreStep(current[currentAt], planned[plannedAt], steps.Count));
                nextPlanned = plannedAt + 1;
                nextCurrent = currentAt + 1;
            }
        }
        return new PlanRestoreResult(prescription, steps, removed);
    }

    /// The longest in-order pairing of planned slots with current rows of the same type (warm-up or
    /// working), earliest rows first.
    private static List<(int Planned, int Current)> AlignByType(IReadOnlyList<BaselineSetSnapshot> planned, IReadOnlyList<CompletedSet> current)
    {
        var best = new int[planned.Count + 1, current.Count + 1];
        for (var p = planned.Count - 1; p >= 0; p--)
        for (var c = current.Count - 1; c >= 0; c--)
            best[p, c] = planned[p].Warmup == current[c].Warmup
                ? best[p + 1, c + 1] + 1
                : Math.Max(best[p + 1, c], best[p, c + 1]);
        var pairs = new List<(int, int)>();
        for (int p = 0, c = 0; p < planned.Count && c < current.Count;)
        {
            if (planned[p].Warmup == current[c].Warmup) pairs.Add((p++, c++));
            else if (best[p + 1, c] >= best[p, c + 1]) p++;
            else c++;
        }
        return pairs;
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
