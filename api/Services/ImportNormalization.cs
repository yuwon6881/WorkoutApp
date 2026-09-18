namespace Workout.Api.Services;

/// The document decides what a program says; this app decides what it can store. A written program
/// regularly says something the stored shape cannot hold exactly: a timed hold or AMRAP finisher
/// with no rep count, a range written high to low, a paragraph of coaching longer than a note
/// field, an RPE written with a stray decimal. Rejecting the read over any of those throws away a
/// whole section the model has already been paid to transcribe, and leaves the import stuck on a
/// section that fails the same way on every retry.
///
/// So each value is brought into range here rather than refused, and labelled `inferred` whenever
/// the stored number no longer came straight from the page. Nothing written is lost: the verbatim
/// notation stays in repsText, restText, percent1Rm, and rir for the reviewer to read.
internal static class ImportNormalization
{
    /// Free text trimmed to what its column holds. Truncating the tail of an unusually long note
    /// is better than failing an import over it.
    public static string? Text(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max].TrimEnd();
    }

    /// A required label. Everything on a review screen needs something to show, so a row the model
    /// left unnamed gets a plain stand-in rather than blocking the whole read.
    public static string Label(string? value, int max, string fallback)
        => Text(value, max) ?? fallback;

    /// A page number the read reported. A number outside the document is a miscount, and an
    /// unknown page is better than a wrong one or a refused section.
    public static int? Page(int? page)
        => page is { } value && value > 0 && value <= ImportSourceText.MaxPages ? value : null;

    /// A week number as the document counts them, held to the range a stored week has.
    public static int Week(int week) => Math.Clamp(week, 1, 104);

    /// An ISO weekday, or none. A day the read could not place keeps no weekday at all; the review
    /// screen asks for one before the program can be activated.
    public static int? Weekday(int? weekday) => weekday is >= 1 and <= 7 ? weekday : null;

    /// Where a stored value came from. Anything this app does not recognise is its own suggestion
    /// rather than something the page is known to have said.
    public static string Provenance(string? source)
        => source is "extracted" or "userEdited" ? source : "inferred";

    /// Rep bounds for a row that may not state reps at all. A stored set needs 1-1000 with the low
    /// bound first; `Adjusted` reports whether that required changing what the model returned.
    public static (int Min, int Max, bool Adjusted) Reps(int min, int max)
    {
        var low = Math.Min(min, max);
        var high = Math.Max(min, max);
        var adjusted = min > max || low < 1 || high > 1000;
        return (Math.Clamp(low, 1, 1000), Math.Clamp(high, 1, 1000), adjusted);
    }

    /// RPE is rated 1-10 in half points. A value outside that scale is a transcription slip rather
    /// than precision, so it is snapped to the nearest storable point and marked inferred.
    public static (double? Value, bool Adjusted) Rpe(double? value)
    {
        if (value is not { } rpe || !double.IsFinite(rpe)) return (null, false);
        var snapped = Math.Clamp(Math.Round(rpe * 2, MidpointRounding.AwayFromZero) / 2, 1, 10);
        return (snapped, Math.Abs(snapped - rpe) > 1e-9);
    }

    /// Rest in seconds, within the range a set can hold.
    public static (int? Value, bool Adjusted) Rest(int? seconds)
    {
        if (seconds is not { } rest) return (null, false);
        var clamped = Math.Clamp(rest, 0, 3600);
        return (clamped, clamped != rest);
    }

    /// The alternates an exercise offers, cleaned of blanks and trimmed to what a name holds. The
    /// caller decides how many of them fit.
    public static List<string> Alternates(List<string>? substitutions)
        => (substitutions ?? []).Select(value => Text(value, 160)).Where(value => value is not null).Select(value => value!).ToList();
}
