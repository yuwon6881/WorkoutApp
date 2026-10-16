using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

internal static partial class ImportTableEvidence
{
    internal sealed record CoachingEffort(double? Rpe, string Rir, string? Printed);

    private static Dictionary<int, CoachingEffort> ReadCoachingEffort(EvidenceRow row)
    {
        var result = new Dictionary<int, CoachingEffort>();
        if (row.WorkingSets is not > 0 || !HasText(row.CoachingNote)) return result;
        var count = row.WorkingSets.Value;
        // A single prescribed working set can put its effort in the coaching column,
        // e.g. "WORK UP TO A HEAVY SET OF 5 @RPE9" or a reserve-qualified AMRAP.
        if (count == 1 && row.Rpe is null && row.EarlyRpe is null && row.LastRpe is null
            && row.RirText is null && row.RirBySet.All(value => value.Text is null)
            && !Regex.IsMatch(row.CoachingNote!, @"\b(?:if|unless|when)\b", RegexOptions.IgnoreCase))
        {
            var targets = Regex.Matches(row.CoachingNote!, @"@\s*RPE\s*(?<value>\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)(?![\d.])", RegexOptions.IgnoreCase)
                .Select(match => CoachedRpe(match.Groups["value"].Value)).Where(value => value is not null).Distinct().ToList();
            if (targets.Count == 1) result[0] = targets[0]!;
        }
        var candidates = new List<(int Index, CoachingEffort Effort)>();
        foreach (Match clause in Regex.Matches(row.CoachingNote!, @"\bset\s+(?<set>\d+)\b(?<clause>.*?)(?=\bset\s+\d+\b|$)", RegexOptions.IgnoreCase))
        {
            var prefix = row.CoachingNote![..clause.Index].TrimEnd();
            if (prefix.Length > 0 && !".!?;".Contains(prefix[^1])) continue;
            if (!int.TryParse(clause.Groups["set"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var number)) continue;
            var index = number - 1;
            if (index < 0 || index >= count) continue;
            var text = clause.Groups["clause"].Value;
            if (Regex.IsMatch(text, @"\b(?:if|unless|when)\b", RegexOptions.IgnoreCase)) continue;
            var printed = Regex.Match(text, @"\bRPE\s+(?<value>\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)", RegexOptions.IgnoreCase);
            CoachingEffort? effort = printed.Success ? CoachedRpe(printed.Groups["value"].Value) : null;
            if (effort is null && AffirmativeFailure(text)) effort = new(10, "0", null);
            if (effort is not null) candidates.Add((index, effort));
        }
        foreach (var group in candidates.GroupBy(item => item.Index))
        {
            var values = group.Select(item => item.Effort).Distinct().ToList();
            if (values.Count == 1) result[group.Key] = values[0];
        }
        // A specific final-set instruction narrows a row-wide effort, like the LSTF column.
        // An explicit final-set effort column remains authoritative.
        if (!result.ContainsKey(count - 1) && row.LastRpe is null
            && Regex.IsMatch(row.CoachingNote!, @"\b(?:last|final)\s+set\b[^.!?]{0,120}\b(?:to|hit|reach(?:ing)?)\s+(?:true\s+)?failure\b", RegexOptions.IgnoreCase)
            && AffirmativeFailure(row.CoachingNote!))
            result[count - 1] = new(10, "0", null);
        return result;
    }

    private static bool AffirmativeFailure(string text)
        => Regex.IsMatch(text, @"\b(?:to|hit|reach(?:ing)?)\s+(?:true\s+)?failure\b", RegexOptions.IgnoreCase)
            && !Regex.IsMatch(text, @"\b(?:avoid|without)\s+failure\b|\b(?:not|never|don't)\b[^.!?]{0,60}\bfailure\b|\b(?:shy|short)\s+of\s+failure\b", RegexOptions.IgnoreCase);

    private static CoachingEffort? CoachedRpe(string text)
    {
        var values = Regex.Matches(text, @"\d+(?:\.\d+)?").Select(match =>
            double.Parse(match.Value, CultureInfo.InvariantCulture)).ToArray();
        if (values.Length == 0 || values.Any(value => value < 0 || value > 10)
            || values.Length == 2 && values[0] > values[1]) return null;
        // The logger supports 5+ RIR; keep the exact low-effort range beside the set.
        // Do not raise a printed RPE 4–5 to the numeric target's minimum of 6.
        if (values.Max() <= 5) return new(null, "5+", $"Printed RPE: {text}");
        if (values.Min() < 5) return null;
        var rpe = Math.Round(values.Average(), MidpointRounding.AwayFromZero);
        return new(rpe >= 6 ? rpe : null, (10 - rpe).ToString(CultureInfo.InvariantCulture), $"Printed RPE: {text}");
    }
}
