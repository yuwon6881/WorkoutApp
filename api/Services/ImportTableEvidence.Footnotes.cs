using System.Text.RegularExpressions;

namespace Workout.Api.Services;

internal static partial class ImportTableEvidence
{
    private static bool ApplyFailureFooter(string[] cells, List<EvidenceRow> rows, int table)
    {
        if (cells.Length > 1 && !TableSummary.IsMatch(cells[0])) return false;
        // A volume tally can share the reconstructed line with the table's footnote.
        var text = cells.LastOrDefault(HasText)?.Trim() ?? "";
        var match = Regex.Match(text,
            @"^\*?\s*take\s+the\s+(?:final|last)\s+set\s+of\s+each\s+exercise(?:\s+except\s+(?<except>.+?))?\s+to\s+failure[.!]?$",
            RegexOptions.IgnoreCase);
        if (!match.Success) return false;
        var exception = match.Groups["except"].Success ? NormalizeName(match.Groups["except"].Value) : null;
        // An ambiguous exclusion cannot authorize changing every movement's effort.
        if (exception is not null && !rows.Any(row => row.Table == table && NormalizeName(row.ExerciseName ?? "") == exception))
            return false;
        for (var index = 0; index < rows.Count; index++)
        {
            var row = rows[index];
            if (row.Table != table || row.WorkingSets is null || ImportSetKinds.IsWarmupRow(row.ExerciseName)
                || exception is not null && NormalizeName(row.ExerciseName ?? "") == exception) continue;
            var note = HasText(row.CoachingNote) ? $"{row.CoachingNote} {text}" : text;
            var avoidsFailure = Regex.IsMatch(row.CoachingNote ?? "", @"\bavoid\s+failure\b|\bdo\s+not\s+(?:go|train|take.{0,30})\s+to\s+failure\b", RegexOptions.IgnoreCase);
            rows[index] = row with { LastRpe = avoidsFailure ? row.LastRpe : 10,
                LastEffortAbsent = avoidsFailure && row.LastEffortAbsent, CoachingNote = note };
        }
        return true;
    }
}
