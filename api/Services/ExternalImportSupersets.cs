namespace Workout.Api.Services;

/// A printed program often labels every pair of a day A1/A2, so one label can name two separate supersets.
/// When every run of consecutive rows sharing a label is itself a superset (two or more rows), each run is its own
/// superset and a later run takes the next free letter. A label whose run is a single row is a real mistake
/// (a superset interrupted by another exercise) and is left for the adjacency check to report.
internal static class ExternalImportSupersets
{
    public static List<DraftExercise> SeparateReusedLabels(List<DraftExercise> exercises)
    {
        var runs = Runs(exercises);
        var splittable = runs.GroupBy(run => run.Label, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1 && group.All(run => run.Count >= 2)).Select(group => group.Key)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (splittable.Count == 0) return exercises;
        var used = runs.Select(run => run.Label).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var result = new List<DraftExercise>(exercises);
        foreach (var run in runs.Where(run => splittable.Contains(run.Label)))
        {
            if (seen.Add(run.Label)) continue;
            var replacement = NextFree(used);
            if (replacement is null) continue;
            used.Add(replacement);
            for (var index = run.Start; index < run.Start + run.Count; index++)
                result[index] = result[index] with { SequenceGroup = replacement };
        }
        return result;
    }

    /// A printed pair is labelled A1 and A2, and an assistant often copies those into the label as they stand, which
    /// reads as two supersets of one exercise each. Consecutive rows that share a letter and count upward are one
    /// superset under that letter; a pair that starts the count again, or whose letter is already another group's,
    /// takes the next free letter. A numbered label with no partner is left for the size check to report.
    public static List<DraftExercise> MergeNumberedLabels(List<DraftExercise> exercises)
    {
        var used = exercises.Select(exercise => exercise.SequenceGroup).Where(label => !string.IsNullOrWhiteSpace(label))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        List<DraftExercise>? result = null;
        for (var start = 0; start < exercises.Count;)
        {
            var count = NumberedRun(exercises, start);
            if (count >= 2)
            {
                var letter = Numbered(exercises[start].SequenceGroup)!.Value.Letter;
                var label = used.Add(letter) ? letter : NextFree(used);
                if (label is not null)
                {
                    used.Add(label);
                    result ??= [.. exercises];
                    for (var index = start; index < start + count; index++)
                        result[index] = result[index] with { SequenceGroup = label };
                }
            }
            start += Math.Max(count, 1);
        }
        return result ?? exercises;
    }

    /// How many rows from this one share a letter and count upward (A1, A2, A3); zero when it is not numbered.
    private static int NumberedRun(List<DraftExercise> exercises, int start)
    {
        if (Numbered(exercises[start].SequenceGroup) is not { } first) return 0;
        var count = 1;
        var previous = first.Number;
        while (start + count < exercises.Count && Numbered(exercises[start + count].SequenceGroup) is { } next
            && string.Equals(next.Letter, first.Letter, StringComparison.OrdinalIgnoreCase) && next.Number > previous)
        {
            previous = next.Number;
            count++;
        }
        return count;
    }

    private static (string Letter, int Number)? Numbered(string? label)
    {
        var match = System.Text.RegularExpressions.Regex.Match(label ?? "", @"^(?<letter>[A-Za-z])(?<number>\d{1,2})$");
        return match.Success ? (match.Groups["letter"].Value, int.Parse(match.Groups["number"].Value, System.Globalization.CultureInfo.InvariantCulture)) : null;
    }

    private static List<(string Label, int Start, int Count)> Runs(List<DraftExercise> exercises)
    {
        var runs = new List<(string Label, int Start, int Count)>();
        for (var index = 0; index < exercises.Count; index++)
        {
            var label = exercises[index].SequenceGroup;
            if (string.IsNullOrWhiteSpace(label)) continue;
            if (runs.Count > 0 && runs[^1].Start + runs[^1].Count == index && string.Equals(runs[^1].Label, label, StringComparison.OrdinalIgnoreCase))
                runs[^1] = runs[^1] with { Count = runs[^1].Count + 1 };
            else runs.Add((label, index, 1));
        }
        return runs;
    }

    private static string? NextFree(HashSet<string> used)
    {
        for (var letter = 'A'; letter <= 'Z'; letter++)
            if (!used.Contains(letter.ToString())) return letter.ToString();
        return null;
    }
}
