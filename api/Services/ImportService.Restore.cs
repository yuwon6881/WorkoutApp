using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    public async Task<ImportView> RestoreDraft(Guid id, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        TemplateService.RequireFresh(revision, import.Revision);
        if (string.IsNullOrEmpty(import.DraftBaselineJson)) import.DraftBaselineJson = import.DraftJson;
        Validation.Require(!string.IsNullOrEmpty(import.DraftBaselineJson), "No default baseline exists for this draft.", 409);

        var baselineDraft = Json.Read<ImportDraft>(import.DraftBaselineJson);
        await ValidateDraft(baselineDraft, ct);
        import.DraftJson = import.DraftBaselineJson;
        import.Revision++;
        UpdateCounters(import, baselineDraft);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    public async Task<ImportView> RestoreExercise(Guid id, Guid exerciseLineId, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        TemplateService.RequireFresh(revision, import.Revision);
        if (string.IsNullOrEmpty(import.DraftBaselineJson)) import.DraftBaselineJson = import.DraftJson;
        Validation.Require(!string.IsNullOrEmpty(import.DraftBaselineJson), "No default baseline exists for this draft.", 409);

        var baselineDraft = Json.Read<ImportDraft>(import.DraftBaselineJson);
        var baselineExercise = baselineDraft.Workouts.SelectMany(w => w.Exercises).FirstOrDefault(e => e.LineId == exerciseLineId);
        Validation.Require(baselineExercise != null, "That exercise cannot be restored to its default.", 404);

        var draft = Json.Read<ImportDraft>(import.DraftJson);
        var targetWorkout = draft.Workouts.FirstOrDefault(w => w.Exercises.Any(e => e.LineId == exerciseLineId));
        Validation.Require(targetWorkout != null, "That exercise is no longer in this draft.", 404);

        var nextExercises = targetWorkout!.Exercises.Select(e => e.LineId == exerciseLineId ? baselineExercise! : e).ToList();
        var nextWorkout = targetWorkout with { Exercises = nextExercises };
        var nextDraft = draft with { Workouts = draft.Workouts.Select(w => w.LineId == nextWorkout.LineId ? nextWorkout : w).ToList() };

        await ValidateWorkout(nextWorkout, ct);
        import.DraftJson = Json.Write(nextDraft);
        import.Revision++;
        UpdateCounters(import, nextDraft);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    public static (bool CanRestoreDraft, List<Guid> RestorableExerciseLineIds) AnalyzeRestorability(AiImport import, ImportDraft? draft)
    {
        if (import.Status != ImportStatus.Ready || draft is null)
            return (false, []);

        var baselineJson = string.IsNullOrEmpty(import.DraftBaselineJson) ? import.DraftJson : import.DraftBaselineJson;
        if (string.IsNullOrEmpty(baselineJson))
            return (false, []);

        var baselineDraft = Json.Read<ImportDraft>(baselineJson);
        var canRestoreDraft = import.DraftJson != baselineJson;
        var restorableIds = new List<Guid>();

        var baselineExercises = baselineDraft.Workouts.SelectMany(w => w.Exercises).ToDictionary(e => e.LineId);
        foreach (var exercise in draft.Workouts.SelectMany(w => w.Exercises))
        {
            if (baselineExercises.TryGetValue(exercise.LineId, out var baseline) && ExerciseDiffers(exercise, baseline))
            {
                restorableIds.Add(exercise.LineId);
            }
        }

        return (canRestoreDraft, restorableIds);
    }

    private static bool ExerciseDiffers(DraftExercise current, DraftExercise baseline)
    {
        if (current.ExerciseId != baseline.ExerciseId) return true;
        if (!string.Equals(current.SourceName?.Trim(), baseline.SourceName?.Trim(), StringComparison.OrdinalIgnoreCase)) return true;
        if ((current.Notes?.Trim() ?? "") != (baseline.Notes?.Trim() ?? "")) return true;
        if ((current.SequenceGroup?.Trim() ?? "") != (baseline.SequenceGroup?.Trim() ?? "")) return true;
        if (current.SourcePage != baseline.SourcePage) return true;
        var curSubs = current.Substitutions ?? [];
        var baseSubs = baseline.Substitutions ?? [];
        if (curSubs.Count != baseSubs.Count || !curSubs.SequenceEqual(baseSubs, StringComparer.OrdinalIgnoreCase)) return true;
        if (current.Sets.Count != baseline.Sets.Count) return true;
        for (var i = 0; i < current.Sets.Count; i++)
        {
            var cs = current.Sets[i]; var bs = baseline.Sets[i];
            if (cs.RepMin != bs.RepMin || cs.RepMax != bs.RepMax || cs.TargetRpe != bs.TargetRpe ||
                cs.RestSeconds != bs.RestSeconds || (cs.Tempo ?? "") != (bs.Tempo ?? "") ||
                (cs.LoadText ?? "") != (bs.LoadText ?? "") || (cs.Notes ?? "") != (bs.Notes ?? "") ||
                cs.Warmup != bs.Warmup || cs.SourcePage != bs.SourcePage ||
                cs.RepsSource != bs.RepsSource || cs.RpeSource != bs.RpeSource || cs.RestSource != bs.RestSource ||
                (cs.RepsText ?? "") != (bs.RepsText ?? "") || (cs.RestText ?? "") != (bs.RestText ?? "") ||
                (cs.Rir ?? "") != (bs.Rir ?? ""))
                return true;
        }
        return false;
    }
}
