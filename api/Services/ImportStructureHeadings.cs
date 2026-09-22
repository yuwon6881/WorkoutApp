using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Shared grammar for the source banners understood by both table and outline reconciliation.
internal static class ImportStructureHeadings
{
    private static readonly Regex Block = new(
        @"^(?:\(\s*)?BLOCK\s+(?<label>[A-Z0-9]+(?:-[A-Z0-9]+)*)(?:\s*:\s*.*)?(?:\s*\))?(?:\s+.*)?$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Week = new(
        // "WEEK 10A" is week 10 in one of its lettered versions; see `ImportWeekVariants`.
        @"^WEEK\s+(?<week>\d+)[A-Z]?(?!\s*(?:[-–]\s*\d|&\s*\d|TO\b\s+\d))(?=$|\s|\|).*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex DayLabel = new(
        @"^DAY\s+LABEL\s*:\s*(?<label>.+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static bool TryBlock(string? value, out string label)
    {
        var match = Block.Match(Collapse(value));
        label = match.Success ? match.Groups["label"].Value.Trim() : "";
        return match.Success && label.Length > 0;
    }

    public static bool TryWeek(string? value, out int week)
    {
        var match = Week.Match(Collapse(value));
        return match.Success && int.TryParse(match.Groups["week"].Value, out week)
            ? true
            : FailWeek(out week);
    }

    public static bool TryDayLabel(string? value, out string label)
    {
        var match = DayLabel.Match(Collapse(value));
        label = match.Success ? match.Groups["label"].Value.Trim() : "";
        return match.Success && label.Length > 0;
    }

    public static string LeadingSegment(string? value)
    {
        var line = value?.Trim() ?? "";
        var pipe = line.IndexOf('|');
        return Collapse(pipe >= 0 ? line[..pipe] : line);
    }

    private static string Collapse(string? value)
        => Regex.Replace(value?.Trim() ?? "", @"\s+", " ");

    private static bool FailWeek(out int week)
    {
        week = 0;
        return false;
    }
}
