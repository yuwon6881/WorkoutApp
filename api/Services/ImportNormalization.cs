using System.Text.RegularExpressions;

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
/// notation stays in repsText, restText, and rir for the reviewer to read.
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

    /// Where a stored value came from. Anything this app does not recognise is its own suggestion
    /// rather than something the page is known to have said.
    public static string Provenance(string? source)
        => source is "extracted" or "userEdited" ? source : "inferred";

    /// Rep bounds for a row that may not state reps at all. Stated bounds are 1-1000 with the low
    /// bound first; when the source gives a simple single number or range, that notation is the
    /// authority over the model's duplicate numeric fields. A row whose reps cell holds no number
    /// ("AMRAP", "N/A", a blank) has no rep target, and none is invented. `Adjusted` reports any change.
    public static (int? Min, int? Max, bool Adjusted) Reps(int? min, int? max, string? text = null)
    {
        if (!string.IsNullOrWhiteSpace(text) && !text.Any(char.IsDigit)) return (null, null, false);
        if (min is not { } statedMin || max is not { } statedMax || statedMin <= 0 && statedMax <= 0)
        {
            if (!TrySimpleReps(text, out _, out _)) return (null, null, false);
            statedMin = statedMax = 0;
        }
        return Stated(statedMin, statedMax, text);
    }

    private static (int? Min, int? Max, bool Adjusted) Stated(int min, int max, string? text)
    {
        if (TrySimpleReps(text, out var parsedMin, out var parsedMax))
        {
            var parsedLow = Math.Min(parsedMin, parsedMax);
            var parsedHigh = Math.Max(parsedMin, parsedMax);
            var normalizedLow = Math.Clamp(parsedLow, 1, 1000);
            var normalizedHigh = Math.Clamp(parsedHigh, 1, 1000);
            return (normalizedLow, normalizedHigh,
                min != parsedLow || max != parsedHigh || parsedMin != parsedLow || parsedMax != parsedHigh ||
                normalizedLow != parsedLow || normalizedHigh != parsedHigh);
        }
        var low = Math.Min(min, max);
        var high = Math.Max(min, max);
        var adjusted = min > max || low < 1 || high > 1000;
        return (Math.Clamp(low, 1, 1000), Math.Clamp(high, 1, 1000), adjusted);
    }

    /// A reps cell that states nothing: blank, a dash, N/A, or a column word such as "NOTES" that a
    /// table prints to point elsewhere. It is not kept as the set's rep text.
    public static string? RepsText(string? text)
    {
        var clean = Text(text, 40);
        return clean is null || Regex.IsMatch(clean, @"^(?:[-–—]+|n/?a|none|notes?|see\s+notes?)$", RegexOptions.IgnoreCase)
            ? null : clean;
    }

    private static bool TrySimpleReps(string? text, out int min, out int max)
    {
        min = max = 0;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var match = Regex.Match(text.Trim(), @"^(?<min>\d+)\s*(?:(?:[-–]|to)\s*(?<max>\d+))?\s*(?:reps?)?$", RegexOptions.IgnoreCase);
        if (!match.Success || !int.TryParse(match.Groups["min"].Value, out min)) return false;
        max = match.Groups["max"].Success && int.TryParse(match.Groups["max"].Value, out var parsedMax) ? parsedMax : min;
        return true;
    }

    /// Target effort corresponds to whole-number RIR on the 6-10 scale. Partial .5 points
    /// are not permitted, so values are snapped to the nearest whole integer and marked inferred.
    public static (double? Value, bool Adjusted) Rpe(double? value)
    {
        if (value is not { } rpe || !double.IsFinite(rpe)) return (null, false);
        var snapped = Math.Clamp(Math.Round(rpe, MidpointRounding.AwayFromZero), 6, 10);
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
