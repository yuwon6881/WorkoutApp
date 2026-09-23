using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Recovers explicit source-table values the model omitted. Rows are matched by their printed
/// movement name whenever possible; positional matching is reserved for one unambiguous table/day.
internal static partial class ImportTableEvidence
{
    private static readonly Regex Page = new(@"(?m)^=== PAGE (?<page>\d+) ===\s*$", RegexOptions.Compiled);
    private static readonly Regex Day = new(@"^(?:LOWER|UPPER)\s+\d+$|^ARMS\s*/\s*DELTS$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex SimpleReps = new(@"^(?<min>\d+)\s*(?:(?:[-–]|\bto\b)\s*(?<max>\d+))?\s*(?:reps?)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex RestValue = new(@"^(?:[~≈]\s*|\bapprox(?:\.|\b)\s*)?(?<min>\d+(?:\.\d+)?)\s*(?:[-–]\s*(?<max>\d+(?:\.\d+)?))?\s*(?<unit>min|mins|minutes?|sec|secs|seconds?|s|m)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Numeric = new(@"^\d+(?:\.\d+)?$", RegexOptions.Compiled);
    private static readonly Regex Percentage = new(@"\b\d+(?:\.\d+)?\s*(?:[-–]\s*\d+(?:\.\d+)?\s*)?%\s*(?:1\s*rm)?", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PageRestMinutes = new(@"\brest\b.{0,45}\b(?:minutes?|mins?)\b|\b(?:minutes?|mins?)\b.{0,45}\brest\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PageRestSeconds = new(@"\brest\b.{0,45}\b(?:seconds?|secs?)\b|\b(?:seconds?|secs?)\b.{0,45}\brest\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    // Min-Max Phase 2 prints "1-2 Rest Days" between its sessions.
    private static readonly Regex RestDay = new(@"^(?:\d(?:\s*[-–]\s*\d)?\s+)?(?:(?:suggested|mandatory|optional)\s+)?rest\s+days?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    /// A rep range, approximate RPE, rest time or percentage: what a row states and a header
    /// never prints. A bare integer is not enough, because tracking columns are headed "1 | 2 | 3".
    private static readonly Regex HeaderValue = new(@"^(?:[~≈]\s*\d.*|\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:min|mins|minutes?|sec|secs|seconds?|s|m|reps?)?|\d+(?:\.\d+)?\s*(?:min|mins|minutes?|sec|secs|seconds?|%)|\d+\.\d+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private const int MaxHeaderLength = 48;

    private sealed record EvidenceRow(string? ExerciseName, int? WorkingSets, string? RepsText, int? RepMin, int? RepMax,
        string? LoadText, string? RirText, double? Rir, List<RirEvidence> RirBySet,
        double? Rpe, double? EarlyRpe, double? LastRpe, string? RestText, int? RestSeconds, bool RestNotStated = false);
    private sealed record RirEvidence(string? Text, double? Value);
    private sealed record EvidencePage(int? Week, string? Block, string? Phase, string? DayName, bool HasRestDayFooter,
        List<EvidenceRow> Rows);
    private sealed record Columns(int? Name, int? Sets, int? Reps, int? Load, int? Rir, int?[] RirBySet,
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
        return program with { Days = WithFooterRestDays(enriched, pages) };
    }

    /// A page that ends on a rest-day band ("1-2 Rest Days") schedules one after its session. The
    /// read kept that rest day in some weeks and dropped it in others, so a band with no rest day
    /// after its session gains one. One day is the least such a band asks for; a band whose rest
    /// day the read already placed, on this page or the next, is left alone.
    private static List<AiDay> WithFooterRestDays(List<AiDay> days, Dictionary<int, EvidencePage> pages)
    {
        var output = new List<AiDay>(days.Count);
        for (var index = 0; index < days.Count; index++)
        {
            var day = days[index];
            output.Add(day);
            if (day.IsRestDay || day.SourcePage is not { } page || !pages.TryGetValue(page, out var evidence) || !evidence.HasRestDayFooter)
                continue;
            var laterOnPage = days.Skip(index + 1).Any(next => !next.IsRestDay && next.SourcePage == page);
            var restFollows = index + 1 < days.Count && days[index + 1].IsRestDay;
            if (laterOnPage || restFollows) continue;
            output.Add(new AiDay(day.Block, day.Phase, day.WeekNumber, day.PhaseWeek, "Rest Day", true, null, [], page));
        }
        return output;
    }

    private static EvidenceRow? MatchRow(AiExercise exercise, int exerciseIndex, List<AiExercise> dayExercises, List<EvidenceRow> rows, bool positionalMatchIsSafe)
    {
        var name = NormalizeName(exercise.SourceName);
        if (name.Length > 0)
        {
            var matches = rows.Where(row => NormalizeName(row.ExerciseName ?? "") == name).Take(2).ToList();
            if (matches.Count == 1) return matches[0];
            if (matches.Count > 1) return null;
            // A read can drop a printed qualifier ("Weak Point Exercise 2" for "... 2 (optional)"),
            // which split one movement into two slots. The printed row still names it uniquely.
            var bare = NormalizeName(WithoutBrackets(exercise.SourceName));
            var qualified = bare.Length == 0 ? [] : rows.Where(row => NormalizeName(WithoutBrackets(row.ExerciseName ?? "")) == bare).Take(2).ToList();
            if (qualified.Count == 1) return qualified[0];
        }
        if (!positionalMatchIsSafe || rows.Count != dayExercises.Count)
            return null;
        return exerciseIndex >= 0 && exerciseIndex < rows.Count ? rows[exerciseIndex] : null;
    }

    private static string WithoutBrackets(string value) => Regex.Replace(value, @"\([^()]*\)|\[[^\[\]]*\]", " ");

    private static bool IsStatedAbsent(string? value)
        => value is not null && Regex.IsMatch(value.Trim(), @"^(?:N/?A|[-–—])$", RegexOptions.IgnoreCase);

    private static string NormalizeName(string value)
    {
        var clean = Regex.Replace(value.Trim(), @"^[A-Z]\d+(?::|\.|\s*[-–]\s+|\s+)\s*", "", RegexOptions.IgnoreCase);
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
        var setRir = index < evidence.RirBySet.Count ? evidence.RirBySet[index] : null;
        var rirText = setRir?.Text ?? evidence.RirText;
        var rir = setRir?.Text is not null ? setRir.Value : evidence.Rir;
        var inferredFromRir = rir is { } rirValue && rirValue is >= 0 and <= 4 ? 10 - Math.Round(rirValue, MidpointRounding.AwayFromZero) : (double?)null;
        var sourceRpe = last ? evidence.LastRpe ?? evidence.EarlyRpe ?? evidence.Rpe : evidence.EarlyRpe ?? evidence.Rpe;
        if (sourceRpe is { } sRpe) sourceRpe = Math.Round(sRpe, MidpointRounding.AwayFromZero);
        var targetRpe = rirText?.Equals("N/A", StringComparison.OrdinalIgnoreCase) == true && index > 0 && set.RpeSource == "inferred"
            ? null : set.TargetRpe ?? inferredFromRir ?? sourceRpe;
        if (targetRpe is { } tRpe) targetRpe = Math.Round(tRpe, MidpointRounding.AwayFromZero);
        var rpeSource = set.TargetRpe is null
            ? inferredFromRir is not null ? "inferred" : sourceRpe is not null ? "extracted" : set.RpeSource
            : set.RpeSource;

        var resolvedRir = rirText?.Equals("N/A", StringComparison.OrdinalIgnoreCase) == true
            ? "N/A"
            : HasText(set.Rir)
                ? (double.TryParse(set.Rir, NumberStyles.Float, CultureInfo.InvariantCulture, out var sRir) ? ((int)Math.Round(sRir)).ToString(CultureInfo.InvariantCulture) : set.Rir)
                : HasText(rirText)
                    ? (double.TryParse(rirText, NumberStyles.Float, CultureInfo.InvariantCulture, out var eRir) ? ((int)Math.Round(eRir)).ToString(CultureInfo.InvariantCulture) : rirText)
                    : targetRpe is { } tVal && tVal is >= 6 and <= 10
                        ? ((int)Math.Round(10 - tVal)).ToString(CultureInfo.InvariantCulture)
                        : null;

        // A rest cell that reads "N/A" states that the row prescribes none. A time the model supplied
        // there came from somewhere else in the document, and would enter the program as printed.
        if (evidence.RestNotStated) set = set with { RestText = null, RestSeconds = null, RestSource = "extracted" };
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
            Rir = resolvedRir,
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
                var leading = ImportStructureHeadings.LeadingSegment(clean);
                if (ImportStructureHeadings.TryWeek(leading, out var nextWeek))
                {
                    if (currentWeek is not null && currentWeek != nextWeek) currentPhase = null;
                    currentWeek = nextWeek;
                }
                else if (ImportStructureHeadings.TryBlock(leading, out var block)) currentBlock = $"Block {block}";
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
        columns = new Columns(null, null, null, null, null, [], null, null, null, null, null, false);
        // A data row mentions the same words a header prints: "Myo-reps" in its technique cell
        // and "sweep the weight up" in its note once read as a reps and a load column, and every
        // later row on the page was then parsed against those. A header states no values.
        if (cells.Any(cell => HeaderValue.IsMatch(cell))) return false;
        int? name = null, sets = null, reps = null, load = null, rir = null;
        var rirBySet = new Dictionary<int, int>();
        int? rpe = null, early = null, last = null, rest = null;
        string? restUnit = null;
        var loadIsPercent1Rm = false;
        for (var i = 0; i < cells.Length; i++)
        {
            var h = Regex.Replace(cells[i].ToLowerInvariant(), @"\s+", " ").Trim();
            // A coaching note is a sentence, never a column label.
            if (h.Length > MaxHeaderLength) continue;
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
            if (isRir && Regex.Match(h, @"\bset\s*(?<index>\d+)\b") is { Success: true } setMatch
                && int.TryParse(setMatch.Groups["index"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var setIndex)
                && setIndex is >= 1 and <= 8) rirBySet[setIndex] = i;
            else if (isRir) rir = i;
            if (isRpe && (h.Contains("early") || h.Contains("first"))) early = i;
            else if (isRpe && (h.Contains("last") || h.Contains("final"))) last = i;
            // The prescribed RPE comes first; an "LSRPE" column after it is where the lifter logs one.
            else if (isRpe) rpe ??= i;
        }
        var recognized = new[] { name, sets, reps, load, rir, rpe, early, last, rest }.Count(value => value.HasValue)
            + rirBySet.Count;
        if (recognized < 2 || (!name.HasValue && !sets.HasValue && !reps.HasValue)) return false;
        // Older tables print the day's title where the name column's label belongs
        // ("FULL BODY #1 | SETS | REPS"); that leading column still holds the movements.
        var assigned = new[] { sets, reps, load, rir, rpe, early, last, rest }.Concat(rirBySet.Values.Select(value => (int?)value));
        if (name is null && (sets ?? reps) > 0 && !assigned.Contains(0)) name = 0;
        var indexedRir = rirBySet.Count == 0 ? [] : Enumerable.Range(1, rirBySet.Keys.Max())
            .Select(index => rirBySet.TryGetValue(index, out var column) ? (int?)column : null).ToArray();
        columns = new Columns(name, sets, reps, load, rir, indexedRir, rpe, early, last, rest, restUnit, loadIsPercent1Rm);
        return true;
    }

    private static bool TryRow(string[] cells, Columns? columns, string? pageRestHint, out EvidenceRow row)
    {
        row = null!;
        if (columns is not null)
        {
            var map = columns;
            var name = Cell(cells, map.Name);
            if (ImportStructureHeadings.TryDayLabel(name, out _)) return false;
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
            var rirBySet = map.RirBySet.Select(column =>
            {
                var value = RirCellText(Cell(cells, column));
                return new RirEvidence(value, ParseRir(value));
            }).ToList();
            var rest = ParseRest(Cell(cells, map.Rest), map.RestUnit ?? pageRestHint);
            var loadText = mixedLoad ?? (combinedIntensity ? null : NormalizeLoad(loadCell, map.LoadIsPercent1Rm));
            if (!HasText(name) && setCount is null && repsText is null && loadText is null && rpe is null && early is null && last is null
                && rirText is null && rirBySet.All(value => value.Text is null) && rest.Text is null) return false;
            row = new EvidenceRow(IsMovementName(name) ? StripSetTag(name!) : null, setCount, repsText, repMin, repMax,
                loadText, rirText, rir, rirBySet, rpe, early, last, rest.Text, rest.Seconds,
                RestNotStated: IsStatedAbsent(Cell(cells, map.Rest)));
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
                null, null, [new RirEvidence(rir1Text, ParseRir(rir1Text)), new RirEvidence(rir2Text, ParseRir(rir2Text))],
                null, null, null, rest.Text, rest.Seconds);
            return true;
        }
        return false;
    }

    private static bool LooksLikeMovementLine(string firstCell, string[] cells)
        => cells.Length >= 1 && cells.Length <= 4 && IsMovementName(firstCell)
           && !TryColumns(cells, out _) && !IsHeaderOrScheduleWord(firstCell);

    private static bool IsHeaderOrScheduleWord(string value)
        => Regex.IsMatch(value, @"\b(exercise|movement|sets?|reps?|rpe|rir|rest|load|warm.?up|substitutions?|notes?)\b", RegexOptions.IgnoreCase)
           || ImportStructureHeadings.TryWeek(value, out _) || ImportStructureHeadings.TryBlock(value, out _)
           || ImportStructureHeadings.TryDayLabel(value, out _) || Day.IsMatch(value) || RestDay.IsMatch(value);

    private static bool IsMovementName(string? value)
        => !string.IsNullOrWhiteSpace(value) && value.Length <= 100 && value.Any(char.IsLetter)
           && !Numeric.IsMatch(value) && !value.Equals("N/A", StringComparison.OrdinalIgnoreCase);

    private static string StripSetTag(string value)
        => Regex.Replace(value.Trim(), @"^[A-Z]\d+(?::|\.|\s*[-–]\s+|\s+)\s*", "", RegexOptions.IgnoreCase);

    private static string? Cell(string[] cells, int? index)
        => index is { } i && i >= 0 && i < cells.Length ? cells[i] : null;

    /// "2 per leg" is two sets done on each side, so the count is still two.
    private static int? ParseSetCount(string? value)
    {
        var clean = CleanValue(value);
        if (clean is not null && Regex.Match(clean, @"^(?<count>\d{1,2})\s+per\s+(?:leg|arm|side)$", RegexOptions.IgnoreCase) is { Success: true } perSide)
            clean = perSide.Groups["count"].Value;
        return int.TryParse(clean, NumberStyles.None, CultureInfo.InvariantCulture, out var count) && count > 0 ? count : null;
    }
}
