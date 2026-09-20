using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Recovers explicit source-table values the model omitted. Rows are matched by their printed
/// movement name whenever possible; positional matching is reserved for one unambiguous table/day.
internal static class ImportTableEvidence
{
    private static readonly Regex Page = new(@"(?m)^=== PAGE (?<page>\d+) ===\s*$", RegexOptions.Compiled);
    private static readonly Regex Week = new(@"^WEEK\s+(?<week>\d+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Block = new(@"^BLOCK\s+(?<block>\d+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Day = new(@"^(?:LOWER|UPPER)\s+\d+$|^ARMS\s*/\s*DELTS$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex SimpleReps = new(@"^(?<min>\d+)\s*(?:(?:[-–]|\bto\b)\s*(?<max>\d+))?\s*(?:reps?)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex RestValue = new(@"^(?<min>\d+(?:\.\d+)?)\s*(?:[-–]\s*(?<max>\d+(?:\.\d+)?))?\s*(?<unit>min|mins|minutes?|sec|secs|seconds?|s|m)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Numeric = new(@"^\d+(?:\.\d+)?$", RegexOptions.Compiled);
    private static readonly Regex Percentage = new(@"\b\d+(?:\.\d+)?\s*(?:[-–]\s*\d+(?:\.\d+)?\s*)?%\s*(?:1\s*rm)?", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PageRestMinutes = new(@"\brest\b.{0,45}\b(?:minutes?|mins?)\b|\b(?:minutes?|mins?)\b.{0,45}\brest\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PageRestSeconds = new(@"\brest\b.{0,45}\b(?:seconds?|secs?)\b|\b(?:seconds?|secs?)\b.{0,45}\brest\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex RestDay = new(@"^(?:(?:suggested|mandatory)\s+)?rest\s+days?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private sealed record EvidenceRow(string? ExerciseName, int? WorkingSets, string? RepsText, int? RepMin, int? RepMax,
        string? LoadText, string? RirText, double? Rir, string? Rir1Text, double? Rir1, string? Rir2Text, double? Rir2,
        double? Rpe, double? EarlyRpe, double? LastRpe, string? RestText, int? RestSeconds);
    private sealed record EvidencePage(int? Week, string? Block, string? Phase, string? DayName, bool HasRestDayFooter,
        List<EvidenceRow> Rows);
    private sealed record Columns(int? Name, int? Sets, int? Reps, int? Load, int? Rir, int? Rir1, int? Rir2,
        int? Rpe, int? EarlyRpe, int? LastRpe, int? Rest, string? RestUnit, bool LoadIsPercent1Rm);

    public static AiProgram Enrich(AiProgram program, string sourceText)
    {
        var pages = Read(sourceText);
        if (pages.Count == 0 || program.Days is not { } days) return program;
        var assignedPages = days.Select(day => (Day: day, Page: day.SourcePage ?? UniqueSourcePage(day.Exercises)))
            .Where(item => item.Page.HasValue)
            .GroupBy(item => item.Page!.Value)
            .ToDictionary(group => group.Key, group => group.Count());
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
            // rows is a training page. Exact-name matches allow several workouts on one page.
            isRestDay = false;
            var positionalMatchIsSafe = assignedPages.GetValueOrDefault(page) == 1;
            var next = exercises.Select((exercise, exerciseIndex) =>
            {
                var row = MatchRow(exercise, exerciseIndex, exercises, evidence.Rows, positionalMatchIsSafe);
                return row is null ? exercise : Apply(exercise, row);
            }).ToList();
            return day with { Block = block, Phase = phase, DayName = dayName, WeekNumber = week, PhaseWeek = phaseWeek,
                IsRestDay = isRestDay, Exercises = next };
        }).ToList();
        return program with { Days = enriched };
    }

    private static EvidenceRow? MatchRow(AiExercise exercise, int exerciseIndex, List<AiExercise> dayExercises, List<EvidenceRow> rows, bool positionalMatchIsSafe)
    {
        var name = NormalizeName(exercise.SourceName);
        if (name.Length > 0)
        {
            var matches = rows.Where(row => NormalizeName(row.ExerciseName ?? "") == name).Take(2).ToList();
            if (matches.Count == 1) return matches[0];
            if (matches.Count > 1) return null;
        }
        if (!positionalMatchIsSafe || rows.Count != dayExercises.Count)
            return null;
        return exerciseIndex >= 0 && exerciseIndex < rows.Count ? rows[exerciseIndex] : null;
    }

    private static string NormalizeName(string value)
    {
        var clean = Regex.Replace(value.Trim(), @"^[A-Z]\d+\s*[:.)-]\s*", "", RegexOptions.IgnoreCase);
        return Regex.Replace(clean, @"[^\p{L}\p{N}]", "").ToLowerInvariant();
    }

    private static int? UniqueSourcePage(List<AiExercise> exercises)
    {
        var pages = exercises.SelectMany(exercise => new int?[] { exercise.SourcePage }
                .Concat(exercise.Sets.Select(set => set.SourcePage)))
            .Where(page => page.HasValue).Select(page => page.GetValueOrDefault()).Distinct().Take(2).ToList();
        return pages.Count == 1 ? pages[0] : null;
    }

    private static AiExercise Apply(AiExercise exercise, EvidenceRow evidence)
    {
        var sets = exercise.Sets?.ToList() ?? [];
        var existingCount = PositiveSetCount(exercise.WorkingSets);
        var required = evidence.WorkingSets ?? existingCount;
        if (required is > 0 && sets.Count > 0)
        {
            while (sets.Count < required.Value)
            {
                var seed = sets[^1];
                sets.Add(seed with { RepsSource = "inferred", RpeSource = "inferred", RestSource = "inferred" });
            }
            if (sets.Count > required.Value)
                sets = sets.Take(required.Value).ToList();
        }
        else if (required is > 0)
        {
            sets = [new AiSet(1, 1, null, null, null, null, null, RepsSource: "inferred", RpeSource: "inferred", RestSource: "inferred")];
        }

        var repaired = sets.Select((set, index) => ApplySet(set, evidence, index, sets.Count)).ToList();
        return exercise with
        {
            SourceName = HasText(evidence.ExerciseName) ? evidence.ExerciseName! : exercise.SourceName,
            WorkingSets = evidence.WorkingSets is { } stated
                ? stated.ToString(CultureInfo.InvariantCulture) : exercise.WorkingSets,
            Sets = repaired
        };
    }

    private static int? PositiveSetCount(string? value)
        => int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var count) && count > 0 ? count : null;

    private static AiSet ApplySet(AiSet set, EvidenceRow evidence, int index, int count)
    {
        var last = index == count - 1;
        var rirText = index == 0 ? evidence.Rir1Text ?? evidence.RirText : evidence.Rir2Text ?? evidence.RirText;
        var rir = index == 0 ? evidence.Rir1 ?? evidence.Rir : evidence.Rir2 ?? evidence.Rir;
        var inferredFromRir = rir is { } rirValue && rirValue is >= 0 and <= 4 ? 10 - rirValue : (double?)null;
        var sourceRpe = last ? evidence.LastRpe ?? evidence.EarlyRpe ?? evidence.Rpe : evidence.EarlyRpe ?? evidence.Rpe;
        var targetRpe = rirText?.Equals("N/A", StringComparison.OrdinalIgnoreCase) == true && index > 0 && set.RpeSource == "inferred"
            ? null : set.TargetRpe ?? inferredFromRir ?? sourceRpe;
        var rpeSource = set.TargetRpe is null
            ? inferredFromRir is not null ? "inferred" : sourceRpe is not null ? "extracted" : set.RpeSource
            : set.RpeSource;

        var restText = HasText(set.RestText) ? set.RestText : evidence.RestText;
        var repsText = HasText(set.RepsText) ? set.RepsText : evidence.RepsText;
        var hasModelRepBounds = set.RepMin > 0 && set.RepMax >= set.RepMin
            && (set.RepMin != 1 || set.RepMax != 1 || HasText(set.RepsText)
                || evidence.RepMin == 1 && evidence.RepMax == 1);
        var (repMin, repMax) = hasModelRepBounds
            ? (set.RepMin, set.RepMax)
            : evidence.RepMin is { } min && evidence.RepMax is { } max ? (min, max) : (set.RepMin, set.RepMax);
        return set with
        {
            RepMin = repMin,
            RepMax = repMax,
            RepsText = repsText,
            RepsSource = !HasText(set.RepsText) && HasText(evidence.RepsText) ? "extracted" : set.RepsSource,
            LoadText = HasText(set.LoadText) ? set.LoadText : evidence.LoadText,
            TargetRpe = targetRpe,
            Rir = rirText?.Equals("N/A", StringComparison.OrdinalIgnoreCase) == true
                ? "N/A" : HasText(set.Rir) ? set.Rir : rirText,
            RpeSource = rpeSource,
            RestText = restText,
            RestSeconds = set.RestSeconds ?? evidence.RestSeconds ?? ParseRestSeconds(restText),
            RestSource = set.RestSeconds is null && (evidence.RestSeconds is not null || HasText(evidence.RestText)) ? "extracted" : set.RestSource
        };
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
            var body = text[start..end];
            var rows = new List<EvidenceRow>();
            var restHint = PageRestMinutes.IsMatch(body) ? "min" : PageRestSeconds.IsMatch(body) ? "sec" : null;
            var columns = (Columns?)null;
            string? pendingName = null;
            string? dayName = null;
            var hasRestDayFooter = false;
            foreach (var line in body.Split('\n'))
            {
                var clean = line.Trim();
                if (Week.Match(clean) is { Success: true } weekMatch)
                {
                    var nextWeek = int.Parse(weekMatch.Groups["week"].Value, CultureInfo.InvariantCulture);
                    if (currentWeek is not null && currentWeek != nextWeek) currentPhase = null;
                    currentWeek = nextWeek;
                }
                else if (Block.Match(clean) is { Success: true } blockMatch) currentBlock = $"Block {blockMatch.Groups["block"].Value}";
                else if (clean.Equals("Intro Week", StringComparison.OrdinalIgnoreCase)) currentPhase = "Intro Week";
                else if (clean.Equals("Deload Week", StringComparison.OrdinalIgnoreCase)) currentPhase = "Deload Week";
                else if (RestDay.IsMatch(clean)) hasRestDayFooter = true;
                else if (Day.IsMatch(clean)) dayName = clean;

                var cells = clean.Split('|').Select(cell => cell.Trim()).ToArray();
                if (TryColumns(cells, out var detected))
                {
                    columns = detected;
                    pendingName = null;
                    continue;
                }
                if (TryRow(cells, columns, restHint, out var row))
                {
                    if (string.IsNullOrWhiteSpace(row.ExerciseName) && !string.IsNullOrWhiteSpace(pendingName)) row = row with { ExerciseName = pendingName };
                    rows.Add(row);
                    pendingName = null;
                    continue;
                }
                var nameCell = cells.Length > 0 ? cells[0] : "";
                if (LooksLikeMovementLine(nameCell, cells)) pendingName = StripSetTag(nameCell);
            }
            if (rows.Count > 0 || dayName is not null || hasRestDayFooter || currentWeek is not null || currentBlock is not null || currentPhase is not null)
                output[page] = new EvidencePage(currentWeek, currentBlock, currentPhase, dayName, hasRestDayFooter, rows);
        }
        return output;
    }

    private static bool TryColumns(string[] cells, out Columns columns)
    {
        columns = new Columns(null, null, null, null, null, null, null, null, null, null, null, null, false);
        int? name = null, sets = null, reps = null, load = null, rir = null, rir1 = null, rir2 = null;
        int? rpe = null, early = null, last = null, rest = null;
        string? restUnit = null;
        var loadIsPercent1Rm = false;
        for (var i = 0; i < cells.Length; i++)
        {
            var h = Regex.Replace(cells[i].ToLowerInvariant(), @"\s+", " ").Trim();
            if (h is "exercise" or "movement" || h.Contains("exercise name") || h.Contains("movement name")) name = i;
            if ((h.Contains("working") && h.Contains("set")) || h is "sets" or "set count" || h.Contains("number of sets")) sets = i;
            if (!h.Contains("tracking") && (h.Contains("rep") || h.Contains("duration")) && !h.Contains("rir") && !h.Contains("rpe")) reps = i;
            if (!h.Contains("tracking") && (h.Contains("load") || h.Contains("weight") || h.Contains("1rm")))
            {
                load = i;
                loadIsPercent1Rm = h.Contains("1rm") || h.Contains("%");
            }
            if (h.Contains("rest"))
            {
                rest = i;
                if (Regex.IsMatch(h, @"\bmin(?:ute)?s?\b")) restUnit = "min";
                else if (Regex.IsMatch(h, @"\bsec(?:ond)?s?\b")) restUnit = "sec";
            }
            var isRir = h.Contains("rir");
            var isRpe = h.Contains("rpe") || Regex.IsMatch(h, @"\bape\b|\blsrpe\b");
            if (isRir && (h.Contains("set 1") || h.Contains("set1") || h.Contains("first"))) rir1 = i;
            else if (isRir && (h.Contains("set 2") || h.Contains("set2") || h.Contains("second"))) rir2 = i;
            else if (isRir) rir = i;
            if (isRpe && (h.Contains("early") || h.Contains("first"))) early = i;
            else if (isRpe && (h.Contains("last") || h.Contains("final"))) last = i;
            else if (isRpe) rpe = i;
        }
        var recognized = new[] { name, sets, reps, load, rir, rir1, rir2, rpe, early, last, rest }.Count(value => value.HasValue);
        if (recognized < 2 || (!name.HasValue && !sets.HasValue && !reps.HasValue)) return false;
        columns = new Columns(name, sets, reps, load, rir, rir1, rir2, rpe, early, last, rest, restUnit, loadIsPercent1Rm);
        return true;
    }

    private static bool TryRow(string[] cells, Columns? columns, string? pageRestHint, out EvidenceRow row)
    {
        row = null!;
        if (columns is not null)
        {
            var map = columns;
            var name = Cell(cells, map.Name);
            var setCount = ParseSetCount(Cell(cells, map.Sets));
            var repsText = CleanValue(Cell(cells, map.Reps));
            var (repMin, repMax) = ParseSimpleReps(repsText);
            var loadCell = Cell(cells, map.Load);
            var combinedIntensity = map.Load is { } loadIndex && map.Rpe == loadIndex;
            var (mixedRpe, mixedLoad) = ParseMixedIntensity(loadCell, map.LoadIsPercent1Rm, combinedIntensity);
            var rpe = ParseRpe(Cell(cells, map.Rpe)) ?? mixedRpe;
            var early = ParseRpe(Cell(cells, map.EarlyRpe));
            var last = ParseRpe(Cell(cells, map.LastRpe));
            var rirText = RirCellText(Cell(cells, map.Rir));
            var rir = ParseRir(rirText);
            var rir1Text = RirCellText(Cell(cells, map.Rir1));
            var rir1 = ParseRir(rir1Text);
            var rir2Text = RirCellText(Cell(cells, map.Rir2));
            var rir2 = ParseRir(rir2Text);
            var rest = ParseRest(Cell(cells, map.Rest), map.RestUnit ?? pageRestHint);
            var loadText = mixedLoad ?? (combinedIntensity ? null : NormalizeLoad(loadCell, map.LoadIsPercent1Rm));
            if (!HasText(name) && setCount is null && repsText is null && loadText is null && rpe is null && early is null && last is null
                && rirText is null && rir1Text is null && rir2Text is null && rest.Text is null) return false;
            row = new EvidenceRow(IsMovementName(name) ? StripSetTag(name!) : null, setCount, repsText, repMin, repMax,
                loadText, rirText, rir, rir1Text, rir1, rir2Text, rir2, rpe, early, last, rest.Text, rest.Seconds);
            return true;
        }

        // Min-Max v10 has no repeated header beside every table. Its explicit separators place
        // warm-up count/reps before working sets, reps, the two RIR cells, and rest.
        for (var i = 0; i + 4 < cells.Length; i++)
        {
            var setCount = ParseSetCount(cells[i]);
            var repsText = CleanValue(cells[i + 1]);
            var rir1Text = RirCellText(cells[i + 2]);
            var rir2Text = RirCellText(cells[i + 3]);
            if (setCount is null || (ParseSimpleReps(repsText).min is null && !IsUnavailable(repsText))
                || !IsRirCell(rir1Text) || !IsRirCell(rir2Text)) continue;
            var rest = ParseRest(cells[i + 4], pageRestHint);
            if (rest.Text is null) continue;
            var (min, max) = ParseSimpleReps(repsText);
            var name = cells.Length > 0 && i > 0 && IsMovementName(cells[0]) ? StripSetTag(cells[0]) : null;
            row = new EvidenceRow(name, setCount, IsUnavailable(repsText) ? null : repsText, min, max, null,
                null, null, rir1Text, ParseRir(rir1Text), rir2Text, ParseRir(rir2Text), null, null, null, rest.Text, rest.Seconds);
            return true;
        }
        return false;
    }

    private static bool LooksLikeMovementLine(string firstCell, string[] cells)
        => cells.Length >= 1 && cells.Length <= 4 && IsMovementName(firstCell)
           && !TryColumns(cells, out _) && !IsHeaderOrScheduleWord(firstCell);

    private static bool IsHeaderOrScheduleWord(string value)
        => Regex.IsMatch(value, @"\b(exercise|movement|sets?|reps?|rpe|rir|rest|load|warm.?up|substitutions?|notes?)\b", RegexOptions.IgnoreCase)
           || Week.IsMatch(value) || Block.IsMatch(value) || Day.IsMatch(value) || RestDay.IsMatch(value);

    private static bool IsMovementName(string? value)
        => !string.IsNullOrWhiteSpace(value) && value.Length <= 100 && value.Any(char.IsLetter)
           && !Numeric.IsMatch(value) && !value.Equals("N/A", StringComparison.OrdinalIgnoreCase);

    private static string StripSetTag(string value)
        => Regex.Replace(value.Trim(), @"^[A-Z]\d+\s*[:.)-]\s*", "", RegexOptions.IgnoreCase);

    private static string? Cell(string[] cells, int? index)
        => index is { } i && i >= 0 && i < cells.Length ? cells[i] : null;

    private static int? ParseSetCount(string? value)
        => int.TryParse(CleanValue(value), NumberStyles.None, CultureInfo.InvariantCulture, out var count) && count > 0 ? count : null;

    private static (int? min, int? max) ParseSimpleReps(string? value)
    {
        if (value is null) return (null, null);
        var match = SimpleReps.Match(value);
        if (!match.Success || !int.TryParse(match.Groups["min"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var min)) return (null, null);
        var max = match.Groups["max"].Success && int.TryParse(match.Groups["max"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var upper) ? upper : min;
        return max >= min ? (min, max) : (null, null);
    }

    private static double? ParseRir(string? value)
        => double.TryParse(CleanValue(value), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && number is >= 0 and <= 10 ? number : null;

    private static double? ParseRpe(string? value)
    {
        var clean = CleanValue(value);
        if (clean is null) return null;
        var match = Regex.Match(clean, @"(?:RPE|APE|LSRPE)?\s*(?<value>\d+(?:\.\d+)?)", RegexOptions.IgnoreCase);
        return match.Success && double.TryParse(match.Groups["value"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            && number is >= 6 and <= 10 ? number : null;
    }

    private static (double? rpe, string? load) ParseMixedIntensity(string? value, bool percentByHeader, bool combinedIntensity)
    {
        if (string.IsNullOrWhiteSpace(value)) return (null, null);
        var percent = Percentage.Match(value);
        var load = percent.Success ? percent.Value.Trim() : null;
        var remainder = percent.Success ? Percentage.Replace(value, " ").Trim(" /|,;()-".ToCharArray()) : value;
        if (percent.Success) return (combinedIntensity ? ParseRpe(remainder) : null, load);
        if (!percentByHeader) return (ParseRpe(remainder), null);
        if (!combinedIntensity) return (null, null);

        var numeric = Regex.Match(value.Trim(), @"^(?<first>\d+(?:\.\d+)?)(?:\s*[-–/]\s*(?<second>\d+(?:\.\d+)?))?$");
        if (!numeric.Success || !double.TryParse(numeric.Groups["first"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var first))
            return (ParseRpe(value), null);
        if (numeric.Groups["second"].Success && double.TryParse(numeric.Groups["second"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var second))
        {
            if (first <= 10 && second > 10) return (first, $"{numeric.Groups["second"].Value}% 1RM");
            if (first > 10 && second > 10) return (null, $"{numeric.Groups["first"].Value}-{numeric.Groups["second"].Value}% 1RM");
            return (ParseRpe(value), null);
        }
        return first > 10 ? (null, $"{numeric.Groups["first"].Value}% 1RM") : (first, null);
    }

    private static string? NormalizeLoad(string? value, bool percentByHeader)
    {
        var clean = CleanValue(value);
        if (clean is null || clean.Equals("See Notes", StringComparison.OrdinalIgnoreCase)
            || Regex.IsMatch(clean, @"^(?:tracking|enter|record)\b", RegexOptions.IgnoreCase)) return null;
        if (percentByHeader && !Percentage.IsMatch(clean))
        {
            var range = Regex.Match(clean, @"^(?<min>\d+(?:\.\d+)?)(?:\s*[-–]\s*(?<max>\d+(?:\.\d+)?))?$");
            if (range.Success) return $"{clean}% 1RM";
        }
        return clean;
    }

    private static (string? Text, int? Seconds) ParseRest(string? value, string? hint)
    {
        var clean = CleanValue(value);
        if (clean is null || IsUnavailable(clean)) return (null, null);
        var match = RestValue.Match(clean);
        if (!match.Success) return (null, null);
        var unit = match.Groups["unit"].Value;
        if (unit.Length == 0)
        {
            if (hint is null) return (null, null);
            unit = hint;
            clean = $"{clean} {unit}";
        }
        if (!double.TryParse(match.Groups["min"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var min)) return (null, null);
        var max = match.Groups["max"].Success && double.TryParse(match.Groups["max"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var upper) ? upper : min;
        var secondsMultiplier = unit.StartsWith("sec", StringComparison.OrdinalIgnoreCase) || unit.Equals("s", StringComparison.OrdinalIgnoreCase) ? 1 : 60;
        return (clean, (int)Math.Round((min + max) / 2 * secondsMultiplier, MidpointRounding.AwayFromZero));
    }

    private static int? ParseRestSeconds(string? text)
        => ParseRest(text, null).Seconds;

    private static bool IsRirCell(string? value) => IsUnavailable(value) || ParseRir(value) is not null;
    private static string? RirCellText(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static bool IsUnavailable(string? value) => string.IsNullOrWhiteSpace(value) || value.Equals("N/A", StringComparison.OrdinalIgnoreCase);
    private static bool HasText(string? value) => !string.IsNullOrWhiteSpace(value);
    private static string? CleanValue(string? value)
        => string.IsNullOrWhiteSpace(value) || IsUnavailable(value) ? null : value.Trim();
}
