using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Reads a rest time a file gives only as text ("1-2 MIN", "30SEC") into seconds.
internal static class ExternalImportRest
{
    private static readonly Regex Rest = new(@"^(?:[~≈]\s*|\bapprox(?:\.|\b)\s*)?(?<min>\d+(?:\.\d+)?)\s*(?:[-–]\s*(?<max>\d+(?:\.\d+)?))?\s*(?<unit>min|mins|minutes?|sec|secs|seconds?|s|m)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// The seconds a printed rest stands for (a range gives its average), or null when the text is not a rest.
    public static int? Seconds(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Trim().Equals("N/A", StringComparison.OrdinalIgnoreCase)) return null;
        var match = Rest.Match(text.Trim());
        if (!match.Success
            || !double.TryParse(match.Groups["min"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var min)) return null;
        var max = match.Groups["max"].Success
            && double.TryParse(match.Groups["max"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var upper) ? upper : min;
        var unit = match.Groups["unit"].Value;
        var multiplier = unit.StartsWith("sec", StringComparison.OrdinalIgnoreCase) || unit.Equals("s", StringComparison.OrdinalIgnoreCase) ? 1 : 60;
        return (int)Math.Round((min + max) / 2 * multiplier, MidpointRounding.AwayFromZero);
    }
}
