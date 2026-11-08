namespace Workout.Api.Services;

/// The review notes are written for a PDF. For a JSON import they are reworded here, keyed on the exact
/// fragments the PDF messages contain. Each fragment must still appear in the API source: a test enforces
/// that, so rewording a PDF message cannot silently leave JSON imports talking about "the PDF".
internal static class ExternalReviewWording
{
    public static readonly IReadOnlyList<(string From, string To)> Replacements =
    [
        ("The document asks for one of", "The import offers one of"),
        ("this PDF prints", "specified by the import"),
        ("the PDF table does not show it as blank", "the supplied JSON leaves its status unclear"),
        ("against the PDF", "against the original source"),
        ("in the PDF", "in the supplied import")
    ];

    public static ImportReviewIssue Apply(ImportReviewIssue issue)
    {
        var message = issue.Message;
        foreach (var (from, to) in Replacements) message = message.Replace(from, to, StringComparison.Ordinal);
        return issue with { Message = message };
    }
}
