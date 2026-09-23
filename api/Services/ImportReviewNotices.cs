namespace Workout.Api.Services;

/// Keeps one current notice per code and workout. Informational notes use limited review space;
/// actionable issues must remain visible even when a large PDF produces more than forty.
internal static class ImportReviewNotices
{
    private const int MaxNotices = 40;

    public static bool IsResolved(ImportReviewIssue notice, ImportDraft draft)
    {
        if (notice.Code != "chunk_day_count" || notice.ExpectedTrainingDays is not { } expected ||
            notice.SourcePage is not { } from || notice.SourcePageTo is not { } to) return false;
        return draft.Workouts.Count(day => !day.IsRestDay &&
            (day.SourcePage is { } page && page >= from && page <= to ||
             day.SourcePage is null && notice.WeekFrom is { } first && notice.WeekTo is { } last &&
             day.Week >= first && day.Week <= last)) >= expected;
    }

    public static List<ImportReviewIssue> Merge(
        IEnumerable<ImportReviewIssue> existing, IEnumerable<ImportReviewIssue> added)
    {
        var distinct = existing.Concat(added).Select((notice, index) => (Notice: notice, Index: index))
            .GroupBy(item => (Code: item.Notice.Code, item.Notice.WorkoutLineId,
                Page: item.Notice.WorkoutLineId is null && !item.Notice.Severity.Equals("info", StringComparison.OrdinalIgnoreCase)
                    ? item.Notice.SourcePage : null), NoticeKeyComparer.Instance)
            .Select(group => group.Last()).OrderBy(item => item.Index).ToList();
        if (distinct.Count <= MaxNotices) return distinct.Select(item => item.Notice).ToList();

        var actionable = distinct.Where(item => !item.Notice.Severity.Equals("info", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var remaining = Math.Max(0, MaxNotices - actionable.Count);
        var informational = remaining == 0 ? [] : distinct
            .Where(item => item.Notice.Severity.Equals("info", StringComparison.OrdinalIgnoreCase))
            .TakeLast(remaining).ToList();
        return actionable.Concat(informational).OrderBy(item => item.Index).Select(item => item.Notice).ToList();
    }

    private sealed class NoticeKeyComparer : IEqualityComparer<(string Code, Guid? WorkoutLineId, int? Page)>
    {
        public static readonly NoticeKeyComparer Instance = new();

        public bool Equals((string Code, Guid? WorkoutLineId, int? Page) left, (string Code, Guid? WorkoutLineId, int? Page) right)
            => left.WorkoutLineId == right.WorkoutLineId
                && left.Page == right.Page
                && string.Equals(left.Code, right.Code, StringComparison.OrdinalIgnoreCase);

        public int GetHashCode((string Code, Guid? WorkoutLineId, int? Page) key)
            => HashCode.Combine(StringComparer.OrdinalIgnoreCase.GetHashCode(key.Code), key.WorkoutLineId, key.Page);
    }
}
