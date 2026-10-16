using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

internal static partial class ImportTableEvidence
{
    /// Older tables place intensity methods in the coaching column rather than in a
    /// dedicated technique column. A slash alone is ambiguous (it can describe ROM).
    /// Mini-set notation needs its own short-rest instruction before it becomes myo-reps.
    private static string? CoachingSetTechnique(EvidenceRow evidence)
    {
        var note = evidence.TechniqueCoachingNote ?? evidence.CoachingNote;
        note ??= "";
        const string methods = @"(?:drop\s?sets?|myo[- ]?reps?)";
        if (Regex.IsMatch(note, $@"\b(?:avoid|never|don't|do\s+not|without|no)\s+(?:use\s+|using\s+|do\s+|doing\s+)?{methods}\b", RegexOptions.IgnoreCase))
            return null;
        if (Regex.IsMatch(note, @"\bdrop\s?sets?\b", RegexOptions.IgnoreCase)
            || Regex.IsMatch(evidence.ExerciseName ?? "", @"\bdrop\s?sets?\b", RegexOptions.IgnoreCase)
            || !Regex.IsMatch(note, @"\breverse\s+pyramid\b|\bback[- ]?off\b|\b(?:for|on)\s+set\s+\d+\b", RegexOptions.IgnoreCase)
            && Regex.IsMatch(note, @"\bdrop\s+the\s+weight\b.{0,80}\b(?:more|another|additional)\b", RegexOptions.IgnoreCase))
            return "Dropset";
        if (Regex.IsMatch(note, @"\bmyo[- ]?reps?\b", RegexOptions.IgnoreCase)
            || Regex.IsMatch(evidence.ExerciseName ?? "", @"\bmyo[- ]?reps?\b", RegexOptions.IgnoreCase)) return "Myo-reps";
        if (Regex.IsMatch(evidence.RepsText ?? "", @"^\d+(?:[-–]\d+)?\s*\(\s*\+\d+(?:\s*\+\d+)+\s*\)$")
            && Regex.IsMatch(note, @"\brest\s+\d+(?:[-–]\d+)?\s+seconds?\b.{0,30}\b(?:do\s+)?another\s+\d+\s+reps?\b", RegexOptions.IgnoreCase))
            return "Myo-reps";
        return null;
    }

    /// An extension qualified as final-set-only does not prescribe extra reps on
    /// earlier straight sets. The final set and exercise coaching keep the full text.
    private static string? BaseTechniqueReps(string? text)
    {
        var match = Regex.Match(text ?? "",
            @"^(?<base>\d+(?:\s*[-–]\s*\d+)?)(?:\s*\(\s*dropset\s*\)|\s*[/+]\s*\d+.*|\s*\(\s*\+\d+.*\))$",
            RegexOptions.IgnoreCase);
        return match.Success ? match.Groups["base"].Value : null;
    }

    private static string? WithoutCoachingTechnique(string? existing, string method)
    {
        if (string.IsNullOrWhiteSpace(existing)) return null;
        var pattern = method == "Dropset" ? @"drop\s?sets?" : @"myo[- ]?reps?";
        var cleaned = Regex.Replace(existing, $@"(?:^|\s*—\s*){pattern}(?:\s*—\s*|$)", "", RegexOptions.IgnoreCase).Trim();
        return cleaned.Length == 0 ? null : cleaned;
    }

    /// An explicit technique cell replaces reader-supplied set-type labels. Keep freeform
    /// coaching and source effort notes; ApplySet adds the printed technique at its stated scope.
    private static string? WithoutPrintedTechnique(string? existing)
    {
        if (string.IsNullOrWhiteSpace(existing)) return null;
        var retained = Regex.Split(existing, @"\s*—\s*")
            .Select(part => part.Trim()).Where(part => part.Length > 0
                && SetTechniques.Of(part) is null && !Regex.IsMatch(part, @"\b(?:failure|amrap)\b", RegexOptions.IgnoreCase));
        var result = string.Join(" — ", retained);
        return result.Length == 0 ? null : result;
    }
}
