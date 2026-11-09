namespace Workout.Api.Services;

/// Which review items are shown to the reviewer.
internal static class ImportReviewPolicy
{
    /// Review items that are only about a set's RIR target.
    private static readonly HashSet<string> RirTargetCodes = new(StringComparer.Ordinal)
    {
        "rpe_unread",
        "rpe_unspecified",
        "percentage_load_without_rpe"
    };

    /// A lifter who does not track RIR is never asked to settle an RIR target before creating a
    /// program. The import still records every printed target, so switching tracking back on shows
    /// them; only the review stops asking.
    public static List<ImportReviewIssue> ForReview(IEnumerable<ImportReviewIssue> issues, bool trackRir)
        => trackRir ? issues.ToList() : issues.Where(issue => !RirTargetCodes.Contains(issue.Code)).ToList();
}
