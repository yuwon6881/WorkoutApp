using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// A generic HOLD cell can point to an explicit time in its own coaching note.
/// Maximum holds, rests and pauses within repetitions do not state a countdown target.
internal static class ImportHoldTargets
{
    public static string? FromCoaching(string? reps, string? note)
    {
        if (!string.Equals(reps?.Trim(), "HOLD", StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(note)) return reps;
        var matches = Regex.Matches(note,
            @"\bhold\b(?:(?!\b(?:rest|between|up\s+to|maximum|max|until|as\s+long|per\s+rep|each\s+rep)\b)[^.!?]){0,160}?\bfor\s+(?<time>\d+(?:\s*[-–]\s*\d+)?\s+(?:seconds?|secs?|minutes?|mins?))\b",
            RegexOptions.IgnoreCase);
        var times = matches.Select(match => match.Groups["time"].Value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return times.Count == 1 ? times[0] : reps;
    }
}
