using System.Text.Json;
using System.Text.RegularExpressions;

namespace Workout.Api.Domain;

/// Intensity techniques a program can prescribe for a working set. The technique is carried in
/// the prescription's set notes (the builder and import write it there), so a completed set's
/// technique is the one its session snapshot prescribed at the same position.
///
/// A technique set is real training work, but its load and reps do not describe straight-set
/// strength: partials shorten the range, myo-reps and drop sets pile extra reps onto a load after
/// short or no rest. Those numbers would inflate an estimated 1RM, fake rep records, and push a
/// load up because the rep count looked easy. So a technique set still counts as volume and as a
/// set, but never as strength evidence, and its progression only learns from its own technique.
/// Failure/AMRAP is not a technique here: it is a full-range straight set, the best strength
/// evidence there is.
public static class SetTechniques
{
    public const string DropSet = "dropset";
    public const string MyoReps = "myoreps";
    public const string LengthenedPartials = "lengthenedPartials";
    public const string IntegratedPartials = "integratedPartials";
    public const string Partials = "partials";

    private static readonly (string Technique, Regex Pattern)[] Patterns =
    [
        (DropSet, new(@"\bdrop\s?sets?\b", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)),
        (MyoReps, new(@"\bmyo[- ]?reps?\b", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)),
        (LengthenedPartials, new(@"\b(?:lengthened|long[- ]length)\s+partials?\b", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)),
        (IntegratedPartials, new(@"\bintegrated\s+partials?\b", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)),
        (Partials, new(@"\bpartials?\b|\bhalf[- ]?rom\b|\bhalf\s+reps?\b", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
    ];

    /// The technique a prescribed set uses, or null for a straight set. Warm-ups have none.
    public static string? Of(SetPrescription? prescription)
        => prescription is null || prescription.Warmup ? null : Of(prescription.Notes);

    public static string? Of(string? notes)
    {
        if (string.IsNullOrWhiteSpace(notes)) return null;
        foreach (var (technique, pattern) in Patterns)
            if (pattern.IsMatch(notes)) return technique;
        return null;
    }

    /// Techniques per set position for one session exercise's prescription snapshot.
    public static IReadOnlyList<string?> ByPosition(string? prescriptionJson)
    {
        if (string.IsNullOrWhiteSpace(prescriptionJson)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<SetPrescription>>(prescriptionJson, JsonOptions)?
                .Select(Of).ToList() ?? [];
        }
        catch (JsonException)
        {
            // An unreadable snapshot cannot say a set used a technique; treat it as straight,
            // which is how every set was counted before techniques were recognised.
            return [];
        }
    }

    /// Whether a completed set at this position may count as straight-set strength evidence.
    public static bool IsStrengthEvidence(IReadOnlyList<string?> techniques, int position)
        => position < 0 || position >= techniques.Count || techniques[position] is null;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}
