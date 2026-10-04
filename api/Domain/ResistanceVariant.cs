using System.Text.RegularExpressions;

namespace Workout.Api.Domain;

/// A bodyweight movement's name already says how it is loaded: "Weighted Pull-Up" adds load,
/// "Assisted Dip" takes some away, and a plain "Pull-Up" is bodyweight alone. The mode follows
/// the exercise rather than a per-set choice, so a set can never claim a plain pull-up carried a
/// plate. Mirrors web/src/lib/resistanceVariant.ts.
public static partial class ResistanceVariant
{
    [GeneratedRegex(@"\bassist(?:ed|ance)?\b", RegexOptions.IgnoreCase)]
    private static partial Regex Assisted();

    [GeneratedRegex(@"\bweighted\b", RegexOptions.IgnoreCase)]
    private static partial Regex Weighted();

    public static string For(string loadModel, string? exerciseName)
    {
        if (loadModel == LoadModels.FullBodyweight)
        {
            var name = exerciseName ?? "";
            if (Assisted().IsMatch(name)) return ResistanceModes.Assistance;
            return Weighted().IsMatch(name) ? ResistanceModes.Added : ResistanceModes.Bodyweight;
        }
        if (loadModel is LoadModels.BodyweightContextOnly or LoadModels.RepsOnly) return ResistanceModes.RepsOnly;
        return ResistanceModes.External;
    }
}
