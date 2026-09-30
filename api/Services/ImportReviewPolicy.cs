namespace Workout.Api.Services;

/// Which review items may stop an import once its pages are read.
///
/// A read is refused only when the draft may not say what the pages print: a week, day, set or
/// value is missing, moved or unread. A document that disagrees with itself in its prose (a note
/// that refers to a set the table does not print, a footer that contradicts an exercise's
/// instruction) was read faithfully; the table is complete and the conflict is the document's.
/// Those go to review, where the lifter resolves them before creating the program, and never
/// cost them the whole import.
internal static class ImportReviewPolicy
{
    /// Conflicts between a document's instructions and its own printed prescription.
    private static readonly HashSet<string> SourceInstructionConflicts = new(StringComparer.Ordinal)
    {
        "working_set_instruction_conflict",
        "effort_instruction_conflict",
        "rep_technique_conflict"
    };

    /// Review items that are only about a set's RIR target.
    private static readonly HashSet<string> RirTargetCodes = new(StringComparer.Ordinal)
    {
        "rpe_unread",
        "rpe_unspecified",
        "percentage_load_without_rpe"
    };

    public static bool StopsRead(ImportReviewIssue issue)
        => !issue.Severity.Equals("info", StringComparison.OrdinalIgnoreCase)
            && !SourceInstructionConflicts.Contains(issue.Code);

    /// A lifter who does not track RIR is never asked to settle an RIR target before creating a
    /// program. The read still records every printed target, so switching tracking back on shows
    /// them; only the review stops asking.
    public static List<ImportReviewIssue> ForReview(IEnumerable<ImportReviewIssue> issues, bool trackRir)
        => trackRir ? issues.ToList() : issues.Where(issue => !RirTargetCodes.Contains(issue.Code)).ToList();
}
