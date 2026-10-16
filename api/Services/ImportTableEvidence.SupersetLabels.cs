using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

internal static partial class ImportTableEvidence
{
    /// Distinguish repeated group labels (S1/S1) from member numbering (A1/A2).
    /// Reusing A1/A2 later starts another group; neither notation may merge separate pairs.
    private static List<EvidenceRow> NormalizeSupersetLabels(List<EvidenceRow> rows)
    {
        var result = rows.ToArray();
        foreach (var table in rows.Select((row, index) => (row, index)).GroupBy(item => item.row.Table))
        {
            var tagged = table.Where(item => item.row.SequenceGroup is not null).ToList();
            if (tagged.Count == 0) continue;
            var labels = tagged.Zip(tagged.Skip(1)).Where(pair => pair.First.row.SequenceGroup == pair.Second.row.SequenceGroup)
                .Select(pair => pair.First.row.SequenceGroup!).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var used = tagged.Where(item => !labels.Contains(item.row.SequenceGroup!))
                .Select(item => Regex.Match(item.row.SequenceGroup!, @"^[A-Z]+", RegexOptions.IgnoreCase).Value.ToUpperInvariant())
                .ToHashSet(StringComparer.Ordinal);
            var assigned = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var positions = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var cycles = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var next = 1;
            foreach (var (row, index) in tagged)
            {
                var printed = row.SequenceGroup!;
                var parts = Regex.Match(printed, @"^(?<group>[A-Z]+)(?<member>\d+)$", RegexOptions.IgnoreCase);
                if (!parts.Success) continue;
                var originalGroup = parts.Groups["group"].Value.ToUpperInvariant();
                var isLabel = labels.Contains(printed);
                var position = isLabel ? positions.GetValueOrDefault(printed) + 1
                    : int.Parse(parts.Groups["member"].Value, CultureInfo.InvariantCulture);
                string identity;
                if (isLabel)
                {
                    positions[printed] = position;
                    identity = "label:" + printed;
                }
                else
                {
                    var cycle = cycles.GetValueOrDefault(originalGroup);
                    if (positions.TryGetValue(originalGroup, out var previous) && position <= previous) cycle++;
                    cycles[originalGroup] = cycle;
                    positions[originalGroup] = position;
                    if (cycle == 0) continue;
                    identity = $"member:{originalGroup}:{cycle}";
                }
                if (!assigned.TryGetValue(identity, out var group))
                {
                    do { group = SupersetLabel(next++); } while (!used.Add(group));
                    assigned[identity] = group;
                }
                var note = isLabel ? $"Printed superset group: {printed}." : $"Printed superset member: {printed}.";
                var coaching = row.CoachingNote?.Contains(note, StringComparison.Ordinal) == true ? row.CoachingNote
                    : HasText(row.CoachingNote) ? $"{row.CoachingNote} {note}" : note;
                result[index] = row with { SequenceGroup = group + position.ToString(CultureInfo.InvariantCulture), CoachingNote = coaching };
            }
        }
        return result.ToList();
    }

    private static string SupersetLabel(int number)
    {
        var label = "";
        while (number > 0)
        {
            number--;
            label = (char)('A' + number % 26) + label;
            number /= 26;
        }
        return label;
    }
}
