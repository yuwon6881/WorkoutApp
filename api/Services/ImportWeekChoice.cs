namespace Workout.Api.Services;

/// The review note left after a version of a program was chosen, so the review says which
/// of the offered versions the draft now holds.
internal static class ImportWeekChoice
{
    public const string ChosenCode = "week_version_chosen";

    public static ImportReviewIssue ChosenNotice(ImportAlternative chosen, IReadOnlyList<ImportAlternative> offered)
        => new(ChosenCode,
            $"The document asks for one of {string.Join(" or ", offered.Select(alternative => alternative.Name))}; {chosen.Name} was imported.",
            "info");
}
