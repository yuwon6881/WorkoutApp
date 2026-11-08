namespace Workout.Api.Services;

internal static class ImportUncertaintyReview
{
    public const string Code = "external_uncertainty";

    public static List<ImportReviewIssue> Issues(ImportDraft draft)
    {
        var issues = new List<ImportReviewIssue>();
        foreach (var option in draft.AlternativeUncertainties ?? [])
            if (option.Uncertainty.Flag)
                issues.Add(new(Code, $"{option.Name}: {option.Uncertainty.Reason ?? "Review this choice."}", "info"));
        foreach (var day in draft.Workouts)
        foreach (var exercise in day.Exercises)
        {
            if (exercise.Uncertainty is { Flag: true } exerciseUncertainty)
                issues.Add(new(Code, $"{exercise.SourceName}: {exerciseUncertainty.Reason ?? "Review this exercise."}", "info",
                    exercise.SourcePage, day.LineId, exercise.LineId));
            for (var index = 0; index < exercise.Sets.Count; index++)
                if (exercise.Sets[index].Uncertainty is { Flag: true } setUncertainty)
                    issues.Add(new(Code, $"{exercise.SourceName}, set {index + 1}: {setUncertainty.Reason ?? "Review this set."}", "info",
                        exercise.Sets[index].SourcePage, day.LineId, exercise.LineId, index));
        }
        return issues;
    }
}
