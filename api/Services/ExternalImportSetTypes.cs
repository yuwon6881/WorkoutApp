using Workout.Api.Domain;

namespace Workout.Api.Services;

/// The set types a file may name. An assistant writes the same type as "AMRAP", "Drop set" or "myo-reps",
/// so capitals, spaces, hyphens and underscores are not part of the name; a type the app does not have is refused.
internal static class ExternalImportSetTypes
{
    public const string Normal = "normal";
    public const string Warmup = "warmup";

    private static readonly Dictionary<string, string?> Techniques = new(StringComparer.Ordinal)
    {
        [Normal] = null, [Warmup] = null,
        ["dropset"] = "Dropset", ["amrap"] = "AMRAP", ["myoreps"] = "Myo-reps",
        ["partials"] = "Partial reps", ["lengthenedpartials"] = "Lengthened partials",
        ["integratedpartials"] = "Integrated partials", ["pause"] = "Pause set",
    };

    /// The type as the format spells it, or null when the set names none.
    public static string? Canonical(string? type)
    {
        if (type is null) return null;
        var key = new string(type.Where(character => character is not (' ' or '-' or '_')).Select(char.ToLowerInvariant).ToArray());
        if (!Techniques.ContainsKey(key))
            throw new DomainException("Choose a supported set type: normal, warmup, dropset, amrap, myoreps, partials, lengthenedPartials, integratedPartials, or pause.");
        return key;
    }

    /// The technique note a canonical type stands for; none for an ordinary or warm-up set.
    public static string? Technique(string? canonical) => canonical is null ? null : Techniques[canonical];
}
