using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

/// Remembers how this account links a written exercise name, so the next import that writes it
/// arrives linked the same way.
///
/// Progression follows the library exercise, so a program that writes "High-Bar Squat" for the
/// lifter's usual "Squat" would otherwise start a second history from nothing. Rather than merge
/// histories after the fact, the written name is resolved to the exercise the lifter already chose
/// for it. A choice is learned only from a link the lifter changed in review and then accepted, it
/// is applied as an exact-name match ahead of the library's own spellings, and linking the name
/// back to the library's pick forgets it. Nothing here changes a logged workout or a progression row.
internal static class ImportNameChoices
{
    internal const string NoticeCode = "remembered_exercise_link";
    private sealed record AppliedRow(Guid ExerciseId, string NameKey);

    /// Active choices are looked up separately from the library's fallback matching. Archived
    /// exercises are skipped, so their names fall back to the library's own match.
    public static async Task<IReadOnlyDictionary<string, Guid>> Apply(AppDb db, CancellationToken ct)
    {
        var choices = await db.ExerciseNameChoices.AsNoTracking()
            .Select(choice => new { choice.NameKey, choice.ExerciseId }).ToListAsync(ct);
        if (choices.Count == 0) return new Dictionary<string, Guid>();
        var shared = await CatalogMetadata.Read(db, ct);
        var ids = choices.Select(choice => choice.ExerciseId).Distinct().ToList();
        var customs = await db.CustomExercises.AsNoTracking()
            .Where(exercise => ids.Contains(exercise.Id) && !exercise.Archived)
            .Select(exercise => exercise.Id).ToListAsync(ct);
        var available = customs.ToHashSet();
        return choices.Where(choice => available.Contains(choice.ExerciseId) ||
                shared.TryGetValue(choice.ExerciseId, out var exercise) && exercise.Active)
            .ToDictionary(choice => choice.NameKey, choice => choice.ExerciseId, StringComparer.Ordinal);
    }

    /// Preserve the rows originally linked by a remembered choice, so notices follow review edits.
    public static IEnumerable<ImportReviewIssue> NoticeMarker(ImportDraft draft, IReadOnlyDictionary<string, Guid> applied)
    {
        var rows = draft.Workouts.SelectMany(workout => workout.Exercises)
            .Where(exercise => exercise.ExerciseId is { } id
                && applied.TryGetValue(CatalogService.Normalize(exercise.SourceName), out var chosen) && chosen == id)
            .ToDictionary(exercise => exercise.LineId,
                exercise => new AppliedRow(exercise.ExerciseId!.Value, CatalogService.Normalize(exercise.SourceName)));
        if (rows.Count > 0) yield return new ImportReviewIssue(NoticeCode, "", "info", TargetField: Json.Write(rows));
    }

    public static IEnumerable<ImportReviewIssue> Notices(ImportDraft? draft, IEnumerable<ImportReviewIssue> notices)
    {
        foreach (var notice in notices)
        {
            if (notice.Code != NoticeCode) { yield return notice; continue; }
            if (draft is null || string.IsNullOrEmpty(notice.TargetField)) continue;
            var rows = Json.Read<Dictionary<Guid, AppliedRow>>(notice.TargetField);
            var names = draft.Workouts.SelectMany(workout => workout.Exercises)
                .Where(exercise => exercise.ExerciseId is { } id && rows.TryGetValue(exercise.LineId, out var chosen)
                    && chosen.ExerciseId == id && chosen.NameKey == CatalogService.Normalize(exercise.SourceName))
                .GroupBy(exercise => CatalogService.Normalize(exercise.SourceName), StringComparer.Ordinal)
                .Select(group => group.First().SourceName.Trim()).ToList();
            if (names.Count == 0) continue;
            var subject = names.Count == 1 ? $"{names[0]} is" : $"{string.Join(", ", names)} are";
            yield return new ImportReviewIssue(NoticeCode,
                $"{subject} linked the way you linked {(names.Count == 1 ? "it" : "them")} in an earlier import, "
                + "so progress continues from that exercise. Change a link here to choose differently next time.", "info");
        }
    }

    /// Records the links the lifter changed in this review. A written name is learned only when
    /// every row that writes it ends on the same exercise, so a name deliberately linked two ways
    /// in one program teaches nothing. Linking a name back to the library's own pick forgets it.
    public static async Task Learn(AppDb db, ImportDraft baseline, ImportDraft accepted,
        Dictionary<string, Guid> library, CancellationToken ct)
    {
        var written = baseline.Workouts.SelectMany(workout => workout.Exercises)
            .GroupBy(exercise => exercise.LineId).ToDictionary(group => group.Key, group => group.First());
        var decisions = new Dictionary<string, (bool Changed, HashSet<Guid?> Ids)>(StringComparer.Ordinal);
        foreach (var exercise in accepted.Workouts.Where(workout => !workout.IsRestDay).SelectMany(workout => workout.Exercises))
        {
            // A row the review added has no written name from the file to remember.
            if (!written.TryGetValue(exercise.LineId, out var original)) continue;
            var key = CatalogService.Normalize(original.SourceName);
            if (key.Length is 0 or > ExerciseNameChoiceLimits.NameKeyLength) continue;
            var decision = decisions.TryGetValue(key, out var seen) ? seen : (Changed: false, Ids: new HashSet<Guid?>());
            decision.Ids.Add(exercise.ExerciseId);
            decisions[key] = (decision.Changed || original.ExerciseId != exercise.ExerciseId, decision.Ids);
        }
        var learned = decisions
            .Where(item => item.Value.Changed && item.Value.Ids.Count == 1 && item.Value.Ids.Single() is not null)
            .ToDictionary(item => item.Key, item => item.Value.Ids.Single()!.Value, StringComparer.Ordinal);
        if (learned.Count == 0) return;

        var keys = learned.Keys.ToList();
        var existing = await db.ExerciseNameChoices.Where(choice => keys.Contains(choice.NameKey)).ToListAsync(ct);
        var byKey = existing.ToDictionary(choice => choice.NameKey, StringComparer.Ordinal);
        foreach (var (key, exerciseId) in learned)
        {
            var libraryPick = CatalogMatching.FindWithDropped(library, key)?.Id;
            byKey.TryGetValue(key, out var choice);
            if (libraryPick == exerciseId)
            {
                if (choice is not null) db.ExerciseNameChoices.Remove(choice);
                continue;
            }
            if (choice is null)
            {
                db.ExerciseNameChoices.Add(new ExerciseNameChoice { UserId = db.CurrentUser!.Value, NameKey = key, ExerciseId = exerciseId });
                continue;
            }
            if (choice.ExerciseId == exerciseId) continue;
            choice.ExerciseId = exerciseId;
            choice.UpdatedAt = DateTime.UtcNow;
            choice.Revision++;
        }
    }
}
