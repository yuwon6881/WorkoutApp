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
