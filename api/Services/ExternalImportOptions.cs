namespace Workout.Api.Services;

/// What the review keeps of the options a file offers for a flagged detail. Only a flagged detail keeps any, and an
/// exercise option survives only when its name is a library movement (other than the one already chosen), so every
/// choice shown to the user can be applied. ExerciseId is always worked out here, never taken from the file.
internal static class ExternalImportOptions
{
    public static ImportUncertainty? ForExercise(ImportUncertainty? uncertainty, Dictionary<string, Guid> library, Guid? matched)
    {
        if (uncertainty is null) return null;
        if (!uncertainty.Flag || uncertainty.Options is not { Count: > 0 } options) return uncertainty with { Options = null };
        var seen = new HashSet<Guid>();
        var kept = new List<ImportOption>();
        foreach (var option in options)
        {
            var id = CatalogMatching.Find(library, option.ExerciseName ?? "");
            if (id is null || id == matched || !seen.Add(id.Value)) continue;
            kept.Add(new ImportOption(option.Label.Trim(), option.ExerciseName!.Trim(), id));
        }
        return uncertainty with { Options = kept.Count == 0 ? null : kept };
    }

    public static ImportUncertainty? ForSet(ImportUncertainty? uncertainty)
    {
        if (uncertainty is null) return null;
        if (!uncertainty.Flag || uncertainty.Options is not { Count: > 0 } options) return uncertainty with { Options = null };
        return uncertainty with
        {
            Options = [.. options.Select(option => new ImportOption(option.Label.Trim(), RepMin: option.RepMin, RepMax: option.RepMax, TargetRpe: option.TargetRpe))
                .DistinctBy(option => (option.RepMin, option.RepMax, option.TargetRpe))]
        };
    }
}
