using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// How a table cell reads as a value: rep ranges, RPE and RIR, loads, and rest times.
internal static partial class ImportTableEvidence
{
    private static (int? min, int? max) ParseSimpleReps(string? value)
    {
        if (value is null) return (null, null);
        var match = SimpleReps.Match(value);
        if (!match.Success || !int.TryParse(match.Groups["min"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var min)) return (null, null);
        var max = match.Groups["max"].Success && int.TryParse(match.Groups["max"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var upper) ? upper : min;
        return max >= min ? (min, max) : (null, null);
    }

    private static double? ParseRir(string? value)
        => double.TryParse(CleanValue(value), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && number is >= 0 and <= 10 ? Math.Round(number, MidpointRounding.AwayFromZero) : null;

    private static double? ParseRpe(string? value)
    {
        var clean = CleanValue(value);
        if (clean is null) return null;
        var rangeMatch = Regex.Match(clean, @"(?:RPE|APE|LSRPE)?\s*(?<min>\d+(?:\.\d+)?)\s*[-–]\s*(?<max>\d+(?:\.\d+)?)", RegexOptions.IgnoreCase);
        if (rangeMatch.Success
            && double.TryParse(rangeMatch.Groups["min"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var minRpe)
            && double.TryParse(rangeMatch.Groups["max"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var maxRpe))
        {
            if (minRpe is >= 5 and <= 10 && maxRpe is >= 5 and <= 10)
                return Math.Round((minRpe + maxRpe) / 2, MidpointRounding.AwayFromZero);
        }
        var match = Regex.Match(clean, @"(?:RPE|APE|LSRPE)?\s*(?<value>\d+(?:\.\d+)?)", RegexOptions.IgnoreCase);
        return match.Success && double.TryParse(match.Groups["value"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            && number is >= 5 and <= 10 ? Math.Round(number, MidpointRounding.AwayFromZero) : null;
    }

    private static (double? rpe, string? load) ParseMixedIntensity(string? value, bool percentByHeader, bool combinedIntensity)
    {
        if (string.IsNullOrWhiteSpace(value)) return (null, null);
        var percent = Percentage.Match(value);
        var load = percent.Success ? percent.Value.Trim() : null;
        var remainder = percent.Success ? Percentage.Replace(value, " ").Trim(" /|,;()-".ToCharArray()) : value;
        if (percent.Success) return (combinedIntensity ? ParseRpe(remainder) : null, load);
        if (!percentByHeader) return (ParseRpe(remainder), null);
        if (!combinedIntensity) return (null, null);

        var numeric = Regex.Match(value.Trim(), @"^(?<first>\d+(?:\.\d+)?)(?:\s*[-–/]\s*(?<second>\d+(?:\.\d+)?))?$");
        if (!numeric.Success || !double.TryParse(numeric.Groups["first"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var first))
            return (ParseRpe(value), null);
        if (numeric.Groups["second"].Success && double.TryParse(numeric.Groups["second"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var second))
        {
            if (first <= 10 && second > 10) return (first, $"{numeric.Groups["second"].Value}% 1RM");
            if (first > 10 && second > 10) return (null, $"{numeric.Groups["first"].Value}-{numeric.Groups["second"].Value}% 1RM");
            return (ParseRpe(value), null);
        }
        return first > 10 ? (null, $"{numeric.Groups["first"].Value}% 1RM") : (first, null);
    }

    private static string? NormalizeLoad(string? value, bool percentByHeader)
    {
        var clean = CleanValue(value);
        if (clean is null || clean.Equals("See Notes", StringComparison.OrdinalIgnoreCase)
            || Regex.IsMatch(clean, @"^(?:tracking|enter|record)\b", RegexOptions.IgnoreCase)) return null;
        if (percentByHeader && !Percentage.IsMatch(clean))
        {
            var range = Regex.Match(clean, @"^(?<min>\d+(?:\.\d+)?)(?:\s*[-–]\s*(?<max>\d+(?:\.\d+)?))?$");
            if (range.Success) return $"{clean}% 1RM";
        }
        return clean;
    }

    private static (string? Text, int? Seconds) ParseRest(string? value, string? hint)
    {
        var clean = CleanValue(value);
        if (clean is null || IsUnavailable(clean)) return (null, null);
        var match = RestValue.Match(clean);
        if (!match.Success && RepeatedRestValues(clean) is { } repeated)
        {
            clean = repeated;
            match = RestValue.Match(clean);
        }
        // Some source PDFs drop the I in "min" ("1-2 MN"). Treat that as minutes only
        // when the same printed page or column independently establishes minute units.
        if (!match.Success && string.Equals(hint, "min", StringComparison.OrdinalIgnoreCase)
            && Regex.Match(clean, @"^(?<min>\d+(?:\.\d+)?)(?:\s*[-–]\s*(?<max>\d+(?:\.\d+)?))?\s*mn$", RegexOptions.IgnoreCase) is { Success: true } abbreviated
            && double.TryParse(abbreviated.Groups["min"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var hintedMin))
        {
            var hintedMax = abbreviated.Groups["max"].Success
                && double.TryParse(abbreviated.Groups["max"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedMax)
                    ? parsedMax : hintedMin;
            return (clean, (int)Math.Round((hintedMin + hintedMax) / 2 * 60, MidpointRounding.AwayFromZero));
        }
        if (!match.Success) return (null, null);
        var unit = match.Groups["unit"].Value;
        if (unit.Length == 0)
        {
            if (hint is null) return (null, null);
            unit = hint;
            clean = $"{clean} {unit}";
        }
        if (!double.TryParse(match.Groups["min"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var min)) return (null, null);
        var max = match.Groups["max"].Success && double.TryParse(match.Groups["max"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var upper) ? upper : min;
        var secondsMultiplier = unit.StartsWith("sec", StringComparison.OrdinalIgnoreCase) || unit.Equals("s", StringComparison.OrdinalIgnoreCase) ? 1 : 60;
        return (clean, (int)Math.Round((min + max) / 2 * secondsMultiplier, MidpointRounding.AwayFromZero));
    }

    /// A fused row can repeat one prescription for two side-by-side movements. Recover only when
    /// every complete time expression is identical; differing values stay unresolved.
    private static string? RepeatedRestValues(string value)
    {
        const string expression = @"(?:[~≈]\s*|\bapprox(?:\.|\b)\s*)?\d+(?:\.\d+)?\s*(?:[-–]\s*\d+(?:\.\d+)?\s*)?(?:min|mins|minutes?|sec|secs|seconds?|s|m)";
        var matches = Regex.Matches(value, expression, RegexOptions.IgnoreCase);
        if (matches.Count < 2 || Regex.Replace(value, expression, "", RegexOptions.IgnoreCase).Trim().Length > 0)
            return null;
        return matches.Cast<Match>().Select(match => match.Value.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count() == 1
            ? matches[0].Value.Trim() : null;
    }

    private static int? ParseRestSeconds(string? text)
        => ParseRest(text, null).Seconds;

    private static bool IsRirCell(string? value) => IsUnavailable(value) || ParseRir(value) is not null;
    private static string? RirCellText(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static bool IsUnavailable(string? value) => string.IsNullOrWhiteSpace(value) || value.Equals("N/A", StringComparison.OrdinalIgnoreCase);
    private static bool HasText(string? value) => !string.IsNullOrWhiteSpace(value);
    private static string? CleanValue(string? value)
        => string.IsNullOrWhiteSpace(value) || IsUnavailable(value) ? null : value.Trim();
}
