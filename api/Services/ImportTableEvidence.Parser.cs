using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

internal static partial class ImportTableEvidence
{
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
            var pageWeeks = new HashSet<int>();
            var restHint = PageRestHint(body);
            var columns = (Columns?)null;
            var table = 0;
            string? pendingName = null;
            string? dayName = null;
            var hasRestDayFooter = false;
            var restBandFollowsTable = false;
            string? dayLabel = null;
            foreach (var line in body.Split('\n'))
            {
                var clean = line.Trim();
                if (clean.StartsWith("DAY LABEL:", StringComparison.OrdinalIgnoreCase)) dayLabel = clean["DAY LABEL:".Length..].Trim();
                var leading = ImportStructureHeadings.LeadingSegment(clean);
                if (ImportStructureHeadings.TryWeek(leading, out var nextWeek))
                {
                    pageWeeks.Add(nextWeek);
                    if (currentWeek is not null && currentWeek != nextWeek) currentPhase = null;
                    currentWeek = nextWeek;
                }
                else if (ImportStructureHeadings.TryBlock(leading, out var block)) currentBlock = $"Block {block}";
                else if (clean.Equals("Intro Week", StringComparison.OrdinalIgnoreCase)) currentPhase = "Intro Week";
                else if (clean.Equals("Deload Week", StringComparison.OrdinalIgnoreCase)) currentPhase = "Deload Week";
                else if (RestDay.IsMatch(clean)) { hasRestDayFooter = true; restBandFollowsTable |= rows.Count > 0; }
                else if (Day.IsMatch(clean)) dayName = clean;

                var cells = clean.Split('|').Select(cell => cell.Trim()).ToArray();
                if (TryColumns(cells, out var detected))
                {
                    columns = detected;
                    table++;
                    pendingName = null;
                    continue;
                }
                if (TryRow(cells, columns, restHint, out var row))
                {
                    if (string.IsNullOrWhiteSpace(row.ExerciseName) && !string.IsNullOrWhiteSpace(pendingName)) row = row with { ExerciseName = pendingName };
                    var expanded = ExpandSupersetRow(row, cells, columns, restHint);
                    rows.AddRange(expanded.Select(item => item with
                    {
                        DayLabel = dayLabel, Table = table, Prose = item.Prose || IsRunningFooter(cells, item)
                    }));
                    pendingName = null;
                    continue;
                }
                var nameCell = cells.Length > 0 ? cells[0] : "";
                if (LooksLikeMovementLine(nameCell, cells)) pendingName = StripSetTag(nameCell);
            }
            var pageWeek = pageWeeks.Count switch
            {
                0 => currentWeek,
                1 => pageWeeks.Single(),
                _ => null
            };
            if (rows.Count > 0 || dayName is not null || hasRestDayFooter || currentWeek is not null || currentBlock is not null || currentPhase is not null)
                output[page] = new EvidencePage(pageWeek, currentBlock, currentPhase, dayName, hasRestDayFooter, rows,
                    restBandFollowsTable || rows.Count == 0, body);
        }
        return output;
    }

    /// A rest header may omit its unit while the rows on that page supply it. Read the rest
    /// column itself so a note about minutes elsewhere on the page cannot change a prescription.
    private static string? PageRestHint(string body)
    {
        if (PageRestMinutes.IsMatch(body)) return "min";
        if (PageRestSeconds.IsMatch(body)) return "sec";

        int? restColumn = null;
        var units = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in body.Split('\n'))
        {
            var cells = line.Trim().Split('|').Select(cell => cell.Trim()).ToArray();
            if (TryColumns(cells, out var columns))
            {
                restColumn = columns.Rest;
                if (columns.RestUnit is { } headerUnit) units.Add(headerUnit);
                continue;
            }
            if (restColumn is not { } index || index >= cells.Length) continue;
            var value = RestValue.Match(cells[index]);
            if (!value.Success) continue;
            var unit = value.Groups["unit"].Value;
            if (unit.StartsWith("min", StringComparison.OrdinalIgnoreCase)) units.Add("min");
            else if (unit.StartsWith("sec", StringComparison.OrdinalIgnoreCase) || unit.Equals("s", StringComparison.OrdinalIgnoreCase)) units.Add("sec");
        }
        return units.Count == 1 ? units.Single() : null;
    }

    private static bool TryColumns(string[] cells, out Columns columns)
    {
        columns = new Columns(null, null, null, null, null, [], null, null, null, null, null, false);
        // A data row mentions the same words a header prints: "Myo-reps" in its technique cell
        // and "sweep the weight up" in its note once read as a reps and a load column, and every
        // later row on the page was then parsed against those. A header states no values.
        if (cells.Any(cell => HeaderValue.IsMatch(cell))) return false;
        int? name = null, sets = null, reps = null, load = null, rir = null, warmup = null, notes = null, technique = null, tempo = null;
        var rirBySet = new Dictionary<int, int>();
        var substitutions = new List<int>();
        int? rpe = null, early = null, last = null, rest = null;
        string? restUnit = null;
        var loadIsPercent1Rm = false;
        var hasWarmup = false;
        for (var i = 0; i < cells.Length; i++)
        {
            var h = Regex.Replace(cells[i].ToLowerInvariant(), @"\s+", " ").Trim();
            // A coaching note is a sentence, never a column label.
            if (h.Length > MaxHeaderLength) continue;
            if (h.Contains("warm")) { hasWarmup = true; warmup = i; }
            if (h is "notes" or "coaching notes") notes = i;
            // "Last-Set Intensity Technique" is how the final working set is done; the model puts it in that set's notes.
            if (h.Contains("technique")) technique = i;
            if (h == "tempo") tempo = i;
            if (h.Contains("substitut") || Regex.IsMatch(h, @"^option\s*\d$")) substitutions.Add(i);
            if (h is "exercise" or "movement" || h.Contains("exercise name") || h.Contains("movement name")) name = i;
            if ((h.Contains("working") && h.Contains("set")) || h is "sets" or "set count" || h.Contains("number of sets")) sets = i;
            if (!h.Contains("tracking") && (h.Contains("rep") || h.Contains("duration")) && !h.Contains("rir") && !h.Contains("rpe")) reps = i;
            if (!h.Contains("tracking") && (h.Contains("load") || h.Contains("weight") || h.Contains("1rm") || h.Contains("%")))
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
        columns = new Columns(name, sets, reps, load, rir, indexedRir, rpe, early, last, rest,
            restUnit, loadIsPercent1Rm, hasWarmup, warmup, notes, [.. substitutions], technique, tempo);
        return true;
    }

    private static bool TryRow(string[] cells, Columns? columns, string? pageRestHint, out EvidenceRow row)
    {
        row = null!;
        if (columns is not null)
        {
            var map = columns;
            var name = Cell(cells, map.Name);
            if (ImportStructureHeadings.TryDayLabel(name, out _) || TableSummary.IsMatch(name?.Trim() ?? "")) return false;
            var setCell = Cell(cells, map.Sets);
            var repsText = CleanValue(Cell(cells, map.Reps));
            var combined = repsText is null ? CombinedSetsAndReps.Match(CleanValue(setCell) ?? "") : Match.Empty;
            var setCount = ParseSetCount(setCell) ?? (combined.Success
                && int.TryParse(combined.Groups["sets"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var combinedSets)
                ? combinedSets : null);
            if (combined.Success) repsText = combined.Groups["reps"].Value;
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
                RestNotStated: IsStatedAbsent(Cell(cells, map.Rest)), WarmupCounted: map.HasWarmup,
                EarlyEffortAbsent: EffortAbsent(cells, map, map.EarlyRpe),
                LastEffortAbsent: EffortAbsent(cells, map, map.LastRpe),
                RestStatedAbsent: map.Rest is null || NoValue(Cell(cells, map.Rest)),
                NotPerformed: IsZero(Cell(cells, map.Sets)) && (IsZero(Cell(cells, map.Reps)) || NoValue(Cell(cells, map.Reps))),
                WarmupText: map.Warmup is { } warmupIndex ? CleanValue(Cell(cells, warmupIndex)) : null,
                CoachingNote: map.Notes is { } notesIndex ? ImportNormalization.Text(Cell(cells, notesIndex), 1000) : null,
                FullHeader: map.Name is not null && map.Sets is not null && map.Reps is not null,
                RepsStatedAbsent: IsStatedAbsent(Cell(cells, map.Reps)),
                WorkingSetPrescriptionText: SetPrescriptionText(setCell),
                WorkingSetsStatedAbsent: IsStatedAbsent(setCell),
                SequenceGroup: PrintedSetTag(name), Substitutions: PrintedSubstitutions(cells, map),
                Prose: (setCount is null || cells.Length <= 2) && repsText is null && loadText is null && rest.Text is null && rpe is null && early is null && last is null
                    && rirText is null && rirBySet.All(value => value.Text is null),
                Technique: NoValue(Cell(cells, map.Technique)) ? null : Cell(cells, map.Technique)!.Trim(),
                Tempo: NoValue(Cell(cells, map.Tempo)) ? null : Cell(cells, map.Tempo)!.Trim());
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
                null, null, null, rest.Text, rest.Seconds, EarlyEffortAbsent: NoValue(rir1Text), LastEffortAbsent: NoValue(rir2Text));
            return true;
        }
        return false;
    }

    private static bool LooksLikeMovementLine(string firstCell, string[] cells)
        => cells.Length >= 1 && cells.Length <= 4 && IsMovementName(firstCell)
           && !TryColumns(cells, out _) && !IsHeaderOrScheduleWord(firstCell);

    private static bool IsHeaderOrScheduleWord(string value)
        => TableSummary.IsMatch(value.Trim())
           || Regex.IsMatch(value, @"\b(exercise|movement|sets?|reps?|rpe|rir|rest|load|warm.?up|substitutions?|notes?)\b", RegexOptions.IgnoreCase)
           || ImportStructureHeadings.TryWeek(value, out _) || ImportStructureHeadings.TryBlock(value, out _)
           || ImportStructureHeadings.TryDayLabel(value, out _) || Day.IsMatch(value) || RestDay.IsMatch(value);

    private static bool IsMovementName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var clean = TrailingVolume.Replace(value, "").Trim();
        return clean.Length > 0 && clean.Length <= 100 && clean.Any(char.IsLetter)
           && !Numeric.IsMatch(clean) && !clean.Equals("N/A", StringComparison.OrdinalIgnoreCase)
           && !TableSummary.IsMatch(clean);
    }

    private static string StripSetTag(string value)
    {
        var stripped = TrailingVolume.Replace(value, "").Trim();
        return ImportSetTags.Strip(stripped);
    }

    private static string? Cell(string[] cells, int? index)
        => index is { } i && i >= 0 && i < cells.Length ? cells[i] : null;

    /// "2 per leg" is two sets done on each side, so the count is still two.
    private static int? ParseSetCount(string? value)
    {
        var clean = CleanValue(value);
        if (clean is not null && Regex.Match(clean, @"^(?<count>\d{1,2})\s+(?:per\s+(?:leg|arm|side)|each)$", RegexOptions.IgnoreCase) is { Success: true } perSide)
            clean = perSide.Groups["count"].Value;
        else if (clean is not null && WorkingSetPrescription.Match(clean) is { Success: true } range
            && int.TryParse(range.Groups["min"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var minimum))
        {
            var upperText = range.Groups["max"].Success ? range.Groups["max"].Value : range.Groups["alternate"].Value;
            if (minimum > 0 && (!int.TryParse(upperText, NumberStyles.None, CultureInfo.InvariantCulture, out var maximum) || maximum >= minimum))
                return minimum;
        }
        return int.TryParse(clean, NumberStyles.None, CultureInfo.InvariantCulture, out var count) && count > 0 ? count : null;
    }

    private static string? SetPrescriptionText(string? value)
    {
        var clean = CleanValue(value);
        return clean is not null && WorkingSetPrescription.IsMatch(clean) ? clean : null;
    }
}
