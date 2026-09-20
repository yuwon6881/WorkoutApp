using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Recovers the numeric columns that are unambiguous in the browser's coordinate-preserving text
/// even when the model has dropped a wrapped RIR or working-set cell. This is deliberately narrow:
/// it fills only values the source table states and leaves all other model output untouched.
internal static class ImportTableEvidence
{
    private static readonly Regex Page = new(@"(?m)^=== PAGE (?<page>\d+) ===\s*$", RegexOptions.Compiled);
    private static readonly Regex Week = new(@"^WEEK\s+(?<week>\d+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Block = new(@"^BLOCK\s+(?<block>\d+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Day = new(@"^(?:LOWER|UPPER)\s+\d+$|^ARMS\s*/\s*DELTS$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Range = new(@"^\d+(?:\s*[-–]\s*\d+)?$", RegexOptions.Compiled);
    private static readonly Regex RepRange = new(@"^(?:N/A|\d+(?:\s*[-–]\s*\d+)?)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Rir = new(@"^(?:N/A|\d+(?:\.\d+)?)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Rest = new(@"^(?:N/A|\d+(?:\.\d+)?(?:\s*[-–]\s*\d+)?\s*(?:min|mins|minutes?|sec|secs|seconds?|s|m))$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private sealed record EvidenceRow(int WorkingSets, string? Rir1Text, string? Rir2Text, int? Rir1, int? Rir2, string RestText);
    private sealed record EvidencePage(int? Week, string? Block, string? Phase, string? DayName, bool HasRestDayFooter,
        List<EvidenceRow> Rows);

    public static AiProgram Enrich(AiProgram program, string sourceText)
    {
        var pages = Read(sourceText);
        if (pages.Count == 0 || program.Days is not { } days) return program;
        var enriched = days.Select(day =>
        {
            var sourcePage = day.SourcePage ?? UniqueSourcePage(day.Exercises);
            if (sourcePage is not { } page || !pages.TryGetValue(page, out var evidence)) return day;
            var block = string.IsNullOrWhiteSpace(day.Block) ? evidence.Block : day.Block;
            var phase = string.IsNullOrWhiteSpace(day.Phase) ? evidence.Phase : day.Phase;
            var dayName = string.IsNullOrWhiteSpace(day.DayName) ? evidence.DayName ?? day.DayName : day.DayName;
            var week = day.WeekNumber > 0 ? day.WeekNumber : evidence.Week ?? day.WeekNumber;
            var phaseWeek = day.PhaseWeek > 0 ? day.PhaseWeek : 1;
            var exercises = day.Exercises ?? [];
            var isRestDay = day.IsRestDay || (exercises.Count == 0 && evidence.HasRestDayFooter);
            if (evidence.Rows.Count == 0 || exercises.Count == 0)
                return day with { Block = block, Phase = phase, DayName = dayName, WeekNumber = week, PhaseWeek = phaseWeek, IsRestDay = isRestDay };
            // A footer band can be mistaken for the day's flag, but a page that also has table
            // rows is a training page. Keep the rows authoritative when the model marked it rest.
            isRestDay = false;
            var next = exercises.Select((exercise, index) => index < evidence.Rows.Count ? Apply(exercise, evidence.Rows[index]) : exercise).ToList();
            return day with { Block = block, Phase = phase, DayName = dayName, WeekNumber = week, PhaseWeek = phaseWeek,
                IsRestDay = isRestDay, Exercises = next };
        }).ToList();
        return program with { Days = enriched };
    }

    private static int? UniqueSourcePage(List<AiExercise> exercises)
    {
        var pages = exercises.SelectMany(exercise => new int?[] { exercise.SourcePage }
                .Concat(exercise.Sets.Select(set => set.SourcePage)))
            .Where(page => page.HasValue)
            .Select(page => page.GetValueOrDefault())
            .Distinct()
            .Take(2)
            .ToList();
        return pages.Count == 1 ? pages[0] : null;
    }

    private static AiExercise Apply(AiExercise exercise, EvidenceRow evidence)
    {
        var sets = exercise.Sets?.ToList() ?? [];
        var required = evidence.WorkingSets;
        if (required > 0 && sets.Count > 0)
        {
            while (sets.Count < required)
            {
                var seed = sets[^1];
                sets.Add(seed with { RepsSource = "inferred", RpeSource = "inferred", RestSource = "inferred" });
            }
            if (sets.Count > required) sets = sets.Take(required).ToList();
        }
        else if (required > 0)
        {
            sets = [new AiSet(1, 1, null, null, null, null, null, RepsSource: "inferred", RpeSource: "inferred", RestSource: "inferred")];
        }

        var repaired = sets.Select((set, index) => ApplySet(set, evidence, index)).ToList();

        return exercise with
        {
            WorkingSets = required > 0 ? required.ToString(CultureInfo.InvariantCulture) : exercise.WorkingSets,
            Sets = repaired
        };
    }

    private static AiSet ApplySet(AiSet set, EvidenceRow evidence, int index)
    {
        var rirText = index == 0 ? evidence.Rir1Text : evidence.Rir2Text;
        var rir = index == 0 ? evidence.Rir1 : evidence.Rir2;
        var target = set.TargetRpe;
        var rpeSource = set.RpeSource;
        if (rir is { } value)
        {
            var inferred = 10 - value;
            if (target is null && inferred is >= 6 and <= 10)
            {
                target = inferred;
                rpeSource = "inferred";
            }
        }
        var restText = string.IsNullOrWhiteSpace(set.RestText) ? evidence.RestText : set.RestText;
        var restSeconds = set.RestSeconds ?? ParseRestSeconds(restText);
        return set with { TargetRpe = target, Rir = rirText ?? set.Rir,
            RpeSource = rpeSource, RestText = restText, RestSeconds = restSeconds,
            RestSource = set.RestSeconds is null ? "extracted" : set.RestSource };
    }

    private static Dictionary<int, EvidencePage> Read(string sourceText)
    {
        var text = sourceText ?? "";
        var pages = Page.Matches(text);
        var output = new Dictionary<int, EvidencePage>();
        int? currentWeek = null;
        string? currentBlock = null;
        string? currentPhase = null;
        for (var index = 0; index < pages.Count; index++)
        {
            var page = int.Parse(pages[index].Groups["page"].Value, CultureInfo.InvariantCulture);
            var start = pages[index].Index + pages[index].Length;
            var end = index + 1 < pages.Count ? pages[index + 1].Index : text.Length;
            var rows = new List<EvidenceRow>();
            string? dayName = null;
            var hasRestDayFooter = false;
            foreach (var line in text[start..end].Split('\n'))
            {
                var clean = line.Trim();
                if (Week.Match(clean) is { Success: true } weekMatch)
                {
                    var nextWeek = int.Parse(weekMatch.Groups["week"].Value, CultureInfo.InvariantCulture);
                    if (currentWeek is not null && currentWeek != nextWeek) currentPhase = null;
                    currentWeek = nextWeek;
                }
                else if (Block.Match(clean) is { Success: true } blockMatch)
                    currentBlock = $"Block {blockMatch.Groups["block"].Value}";
                else if (clean.Equals("Deload Week", StringComparison.OrdinalIgnoreCase)) currentPhase = "Deload Week";
                else if (clean.Equals("Rest Day", StringComparison.OrdinalIgnoreCase)) hasRestDayFooter = true;
                else if (Day.IsMatch(clean)) dayName = clean;
                if (TryRow(clean, out var row)) rows.Add(row);
            }
            if (rows.Count > 0 || dayName is not null || hasRestDayFooter || currentWeek is not null || currentBlock is not null || currentPhase is not null)
                output[page] = new EvidencePage(currentWeek, currentBlock, currentPhase, dayName, hasRestDayFooter, rows);
        }
        return output;
    }

    private static bool TryRow(string line, out EvidenceRow row)
    {
        row = null!;
        var cells = line.Split('|').Select(cell => cell.Trim()).ToList();
        for (var index = 0; index + 5 < cells.Count; index++)
        {
            if (!Range.IsMatch(cells[index]) || !int.TryParse(cells[index + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var working) || working <= 0)
                continue;
            if (!RepRange.IsMatch(cells[index + 2]) || !Rir.IsMatch(cells[index + 3]) || !Rir.IsMatch(cells[index + 4]) || !Rest.IsMatch(cells[index + 5]))
                continue;
            row = new EvidenceRow(working, RirText(cells[index + 3]), RirText(cells[index + 4]),
                Number(cells[index + 3]), Number(cells[index + 4]), cells[index + 5]);
            return true;
        }
        return false;
    }

    private static string? RirText(string value) => value.Equals("N/A", StringComparison.OrdinalIgnoreCase) ? "N/A" : value;

    private static int? Number(string value)
        => int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : null;

    private static int? ParseRestSeconds(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Equals("N/A", StringComparison.OrdinalIgnoreCase)) return null;
        var match = Regex.Match(text, @"(?<min>\d+(?:\.\d+)?)\s*(?:[-–]\s*(?<max>\d+(?:\.\d+)?))?\s*(?<unit>min|mins|minutes?|sec|secs|seconds?|s|m)?", RegexOptions.IgnoreCase);
        if (!match.Success || !double.TryParse(match.Groups["min"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var min)) return null;
        var max = match.Groups["max"].Success && double.TryParse(match.Groups["max"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var upper) ? upper : min;
        var average = (min + max) / 2;
        var unit = match.Groups["unit"].Value.ToLowerInvariant();
        var multiplier = unit is "sec" or "secs" or "second" or "seconds" or "s" ? 1 : 60;
        return (int)Math.Round(average * multiplier, MidpointRounding.AwayFromZero);
    }
}
