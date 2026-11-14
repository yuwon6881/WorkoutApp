using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// The set types a file may name. An assistant writes the same type as "AMRAP", "Drop set" or "myo-reps",
/// so capitals, spaces, hyphens and underscores are not part of the name; a type the app does not have is refused.
internal static class ExternalImportSetTypes
{
    public const string Normal = "normal";
    public const string Warmup = "warmup";
    public const string Amrap = "amrap";
    public const string Tempo = "tempo";

    private static readonly Dictionary<string, string?> Techniques = new(StringComparer.Ordinal)
    {
        [Normal] = null, [Warmup] = null,
        ["dropset"] = "Dropset", [Amrap] = "AMRAP", ["myoreps"] = "Myo-reps",
        ["partials"] = "Partial reps", ["lengthenedpartials"] = "Lengthened partials",
        ["integratedpartials"] = "Integrated partials", ["pause"] = "Pause set", [Tempo] = "Tempo set",
    };

    /// The type as the format spells it, or null when the set names none.
    public static string? Canonical(string? type)
    {
        if (type is null) return null;
        var key = new string(type.Where(character => character is not (' ' or '-' or '_')).Select(char.ToLowerInvariant).ToArray());
        if (key == "temposet") key = Tempo;
        if (!Techniques.ContainsKey(key))
            throw new DomainException("Choose a supported set type: normal, warmup, dropset, amrap, myoreps, partials, lengthenedPartials, integratedPartials, pause, or tempo.");
        return key;
    }

    /// The technique note a canonical type stands for; none for an ordinary or warm-up set.
    public static string? Technique(string? canonical) => canonical is null ? null : Techniques[canonical];

    private const RegexOptions Options = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;
    private static readonly Regex Negative = new(@"\b(?:negatives?|eccentrics?)\b", Options);
    private static readonly Regex NotNegative = new(@"\b(?:no|not|without)\s+(?:slow\s+)?(?:negatives?|eccentrics?)\b", Options);
    private static readonly Regex Seconds = new(@"\b\d+(?:\.\d+)?\s*-?\s*(?:s|secs?|seconds?)\b", Options);
    private static readonly Regex LastSetOnly = new(@"\b(?:last|final)\s+(?:working\s+)?set\b", Options);
    private static readonly Regex OpenReps = new(@"\bamrap\b|\bmax(?:imum)?\s+reps?\b|\bto\s+failure\b|\bas\s+many\s+reps\s+as\s+possible\b", Options);
    private static readonly Regex Sentences = new(@"(?<!\d)\.|\.(?!\d)|[!?;]", RegexOptions.CultureInvariant);

    /// A timed lowering ("3 seconds negative"): the file asks for a controlled tempo on the rep.
    public static bool NamesNegative(string? text)
        => Sentences.Split(text ?? "").Any(sentence => Negative.IsMatch(sentence) && Seconds.IsMatch(sentence) && !NotNegative.IsMatch(sentence));

    /// The type a set's own printed text says when the file gave none. A controlled-tempo set outranks
    /// AMRAP, and any type the file did name outranks both, because a set has one type. Coaching on the
    /// whole exercise reaches every working set unless it is meant for the last set only.
    public static string? Infer(string? named, bool warmup, string? repsText, string? setNotes, string? exerciseNotes)
    {
        if (warmup || named is not (null or Normal or Amrap or Tempo)) return named;
        var everyRep = LastSetOnly.IsMatch(exerciseNotes ?? "") ? null : exerciseNotes;
        if (named == Tempo || NamesNegative(setNotes) || NamesNegative(everyRep)) return Tempo;
        if (named == Amrap) return named;
        return OpenReps.IsMatch(repsText ?? "") || OpenReps.IsMatch(setNotes ?? "") ? Amrap : named;
    }
}
