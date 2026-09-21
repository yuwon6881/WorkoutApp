namespace Workout.Api.Services;

/// Keeps one current notice per code and workout, with actionable issues taking the limited review
/// space before informational notes.
internal static class ImportReviewNotices
{
    private const int MaxNotices = 40;

    public static List<ImportReviewIssue> Merge(
        IEnumerable<ImportReviewIssue> existing, IEnumerable<ImportReviewIssue> added)
    {
        var distinct = existing.Concat(added).Select((notice, index) => (Notice: notice, Index: index))
            .GroupBy(item => (Code: item.Notice.Code, item.Notice.WorkoutLineId), NoticeKeyComparer.Instance)
            .Select(group => group.Last()).OrderBy(item => item.Index).ToList();
        if (distinct.Count <= MaxNotices) return distinct.Select(item => item.Notice).ToList();

        var actionable = distinct.Where(item => !item.Notice.Severity.Equals("info", StringComparison.OrdinalIgnoreCase))
            .TakeLast(MaxNotices).ToList();
        var remaining = MaxNotices - actionable.Count;
        var informational = remaining == 0 ? [] : distinct
            .Where(item => item.Notice.Severity.Equals("info", StringComparison.OrdinalIgnoreCase))
            .TakeLast(remaining).ToList();
        return actionable.Concat(informational).OrderBy(item => item.Index).Select(item => item.Notice).ToList();
    }

    private sealed class NoticeKeyComparer : IEqualityComparer<(string Code, Guid? WorkoutLineId)>
    {
        public static readonly NoticeKeyComparer Instance = new();

        public bool Equals((string Code, Guid? WorkoutLineId) left, (string Code, Guid? WorkoutLineId) right)
            => left.WorkoutLineId == right.WorkoutLineId
                && string.Equals(left.Code, right.Code, StringComparison.OrdinalIgnoreCase);

        public int GetHashCode((string Code, Guid? WorkoutLineId) key)
            => HashCode.Combine(StringComparer.OrdinalIgnoreCase.GetHashCode(key.Code), key.WorkoutLineId);
    }
}
