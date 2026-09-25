using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

internal static partial class ImportTableEvidence
{
    private static readonly Regex SupersetCompositeName = new(
        @"^(?<first>.+?)\s+(?<group>[A-Z]\d{1,2}):\s*(?<second>.+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PairWorkingSets = new(
        @"^(?<first>\d{1,2}(?:\s+EACH)?)\s+(?<second>\d{1,2})$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PairCounts = new(
        @"^(?<first>\d{1,2})\s+(?<second>\d{1,2})$", RegexOptions.Compiled);
    private static readonly Regex PairReps = new(
        @"\d+(?:\s*[-–]\s*\d+)?(?:\s*(?:reps?|seconds?|secs?|sec|s|minutes?|mins?|min))?", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PairEffort = new(
        @"(?:(?:N/?A|[-–—])\s*)?\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PairRest = new(
        @"(?:[~≈]\s*)?\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:min|mins|minutes?|sec|secs|seconds?|s|m)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// Splits a fused pair only when the source marks the second movement with an explicit superset
    /// label and both exercises have independently delimited set, rep, and rest prescriptions.
    private static List<EvidenceRow> ExpandSupersetRow(EvidenceRow row, string[] cells, Columns? columns, string? pageRestHint)
    {
        if (columns is not { } map || !HasText(row.ExerciseName)
            || SupersetCompositeName.Match(row.ExerciseName!) is not { Success: true } name)
            return [row];

        var sets = PairCell(Cell(cells, map.Sets), PairWorkingSets);
        var reps = PairValues(Cell(cells, map.Reps), PairReps);
        var rests = PairValues(Cell(cells, map.Rest), PairRest);
        if (sets is null || reps is null || rests is null) return [row];

        var warmups = map.Warmup is { } warmupColumn ? PairCell(Cell(cells, warmupColumn), PairCounts) : null;
        var loadValues = map.Load is { } loadColumn && map.Load != map.Rpe
            ? PairValues(Cell(cells, loadColumn), PairEffort) : null;
        var effortValues = map.Rpe is { } rpeColumn
            ? PairValues(Cell(cells, rpeColumn), PairEffort)
            : map.Load == map.Rpe && map.Load is { } combinedColumn
                ? PairValues(Cell(cells, combinedColumn), PairEffort) : null;
        var earlyValues = map.EarlyRpe is { } earlyColumn ? PairValues(Cell(cells, earlyColumn), PairEffort) : null;
        var lastValues = map.LastRpe is { } lastColumn ? PairValues(Cell(cells, lastColumn), PairEffort) : null;
        if (map.Rpe is not null && effortValues is null || map.Load is not null && map.Load != map.Rpe && loadValues is null
            || map.EarlyRpe is not null && earlyValues is null || map.LastRpe is not null && lastValues is null)
            return [row];

        var firstName = ImportSetTags.Strip(name.Groups["first"].Value);
        var secondName = ImportSetTags.Strip(name.Groups["second"].Value);
        var group = name.Groups["group"].Value.ToUpperInvariant();
        var result = new List<EvidenceRow>(2);
        for (var index = 0; index < 2; index++)
        {
            var setCell = sets[index];
            var repCell = reps[index];
            var rest = ParseRest(rests[index], map.RestUnit ?? pageRestHint);
            var loadCell = loadValues?[index] ?? (map.Load == map.Rpe ? null : Cell(cells, map.Load));
            var rpeCell = effortValues?[index] ?? (map.Rpe == map.Load ? null : Cell(cells, map.Rpe));
            var (mixedRpe, mixedLoad) = ParseMixedIntensity(loadCell, map.LoadIsPercent1Rm, map.Load == map.Rpe);
            var rowRpe = ParseRpe(rpeCell) ?? mixedRpe;
            var rowLoad = mixedLoad ?? (map.Load == map.Rpe ? null : NormalizeLoad(loadCell, map.LoadIsPercent1Rm));
            var (repMin, repMax) = ParseSimpleReps(repCell);
            var warmupText = warmups?[index] ?? (map.Warmup is { } warmup ? CleanValue(Cell(cells, warmup)) : null);
            var early = earlyValues is null ? row.EarlyRpe : ParseRpe(earlyValues[index]);
            var last = lastValues is null ? row.LastRpe : ParseRpe(lastValues[index]);
            var workingSets = ParseSetCount(setCell);

            result.Add(row with
            {
                ExerciseName = index == 0 ? firstName : secondName,
                WorkingSets = workingSets,
                WorkingSetPrescriptionText = SetPrescriptionText(setCell),
                WorkingSetsStatedAbsent = IsStatedAbsent(setCell),
                RepsText = repCell,
                RepMin = repMin,
                RepMax = repMax,
                LoadText = rowLoad,
                Rpe = rowRpe,
                EarlyRpe = early,
                LastRpe = last,
                RestText = rest.Text,
                RestSeconds = rest.Seconds,
                RestNotStated = IsStatedAbsent(rests[index]),
                RestStatedAbsent = map.Rest is null || NoValue(rests[index]),
                WarmupText = warmupText,
                SequenceGroup = index == 1 ? group : null,
                RepsStatedAbsent = IsStatedAbsent(repCell),
                NotPerformed = IsZero(setCell) && (IsZero(repCell) || NoValue(repCell))
            });
        }
        return result;
    }

    private static string[]? PairValues(string? value, Regex expression)
    {
        if (!HasText(value)) return null;
        var matches = expression.Matches(value!);
        var residue = Regex.Replace(value!, expression.ToString(), "", expression.Options).Trim();
        if (matches.Count != 2 || residue.Length != 0)
            return null;
        return [matches[0].Value.Trim(), matches[1].Value.Trim()];
    }

    private static string[]? PairCell(string? value, Regex expression)
    {
        if (!HasText(value) || expression.Match(value!) is not { Success: true } match) return null;
        return [match.Groups["first"].Value.Trim(), match.Groups["second"].Value.Trim()];
    }
}
