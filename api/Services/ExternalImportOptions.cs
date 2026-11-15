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
            // Applied on one click, so only a movement the name spells in full, qualifiers included: a
            // specific option must not quietly become a generic exercise.
            var id = CatalogMatching.FindUnaltered(library, option.ExerciseName ?? "");
            if (id is null || id == matched || !seen.Add(id.Value)) continue;
            kept.Add(new ImportOption(option.Label.Trim(), option.ExerciseName!.Trim(), id));
        }
        return uncertainty with { Options = kept.Count == 0 ? null : kept };
    }

    /// A link that settled for a shorter name than the file wrote is flagged for review, saying which words were set
    /// aside. A flag the file raised itself already asks for a look and keeps its own reason and options.
    public static ImportUncertainty? FlagDroppedWords(ImportUncertainty? uncertainty, string? dropped, Guid? matched)
    {
        if (matched is null || string.IsNullOrWhiteSpace(dropped) || uncertainty is { Flag: true }) return uncertainty;
        var reason = $"Linked by setting aside \"{dropped}\" from the written name; check this is the same movement.";
        return new ImportUncertainty(true, reason.Length <= 200 ? reason : reason[..199] + "…");
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
