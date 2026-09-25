using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// The superset tag a table prints before a movement: "A1:", "B2.", "C3 -", or the same tag after a
/// word naming the grouping ("Superset A1: Assisted Pull-Up", Pure Bodybuilding). The tag is the
/// movement's sequence group and never part of its name.
internal static class ImportSetTags
{
    private static readonly Regex Tag = new(
        @"^\s*(?:(?:super|tri|giant|compound)[\s-]?sets?\s*|circuit\s*)?(?<tag>[A-Z]\d{1,2})(?::|\.|\s*[-–]\s+|\s+)\s*",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static string Strip(string value) => Tag.Replace(value, "", 1).Trim();

    /// The printed tag in upper case ("A1"), or null when the name carries none.
    public static string? Find(string? value)
        => value is not null && Tag.Match(value) is { Success: true } match ? match.Groups["tag"].Value.ToUpperInvariant() : null;
}
