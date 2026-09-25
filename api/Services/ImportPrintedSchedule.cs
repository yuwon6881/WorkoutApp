using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// <summary>
/// The schedule a PDF prints on its training pages: each page's week heading, its day labels in
/// order, and the rest bands printed after a session. When that schedule is complete and
/// consistent it places every day in its printed week and slot and a rest day wherever a band
/// prints one; a read's own week numbers and rest slots are only the fallback.
/// </summary>
internal sealed class ImportPrintedSchedule
{
    /// A book's phase or block banner: "BLOCK 2", "Phase 3", "Ramping Block".
    private static readonly Regex NamedBlock = new(@"^(?:Phase\s+\d{1,2}|[A-Z][A-Za-z]+\s+Block)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex BareNumber = new(@"^\d{1,2}$", RegexOptions.Compiled);
    private static readonly Regex LetteredWeek = new(@"^WEEK\s+\d+[A-Z]\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex AppendixHeading = new(
        @"^(?:PROGRAM EXPLAINED|WEEKLY VOLUMES?|EXERCISE VIDEO LINKS|REFERENCES|DISCLAIMER)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    /// A week heading after a running title: "PROGRAM: WEEK 1", "... | WEEK 1 (BLOCK 1)".
    private static readonly Regex TitledWeek = new(@"(?:^|[:|/]\s*)WEEK\s+0?(?<week>\d{1,2})(?<letter>[A-Z])?(?=\s*(?:$|\(|\||:|-|\b))", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    internal sealed record SourceDay(int Page, int Week, int PhaseWeek, string? Block, string Label, int RestsAfter, bool IsRestDay = false);

    private readonly List<SourceDay> days;
    private ImportPrintedSchedule(List<SourceDay> days) => this.days = days;

    public IReadOnlyList<SourceDay> Days => days;

    /// Whether an outline's sections reach every page this schedule prints a day on.
    public bool CoveredBy(IEnumerable<AiOutlineChunk> chunks)
    {
        var ranges = chunks.Select(chunk => (chunk.PageFrom, chunk.PageTo)).ToList();
        return days.All(day => ranges.Any(range => day.Page >= range.PageFrom && day.Page <= range.PageTo));
    }

    /// Each printed training page's program week, for placing a section's days as they are read.
    public Dictionary<int, int> WeekOfPage() => days.GroupBy(day => day.Page).ToDictionary(group => group.Key, group => group.First().Week);

    /// Returns only metadata supported by every printed session in the alternative's page ranges.
    public static (int? WeekCount, int? SessionsPerWeek) DescribeAlternative(
        IReadOnlyList<ImportChunk> chunks, IReadOnlyList<ImportPageText> pages)
    {
        if (chunks.Count == 0) return (null, null);
        var ranges = chunks.Select(chunk => (chunk.PageFrom, chunk.PageTo)).ToList();
        var alternativePages = pages.Where(page => ranges.Any(range => page.Page >= range.PageFrom && page.Page <= range.PageTo)).ToList();
        var schedule = Read(alternativePages);
        if (schedule is null) return (null, null);

        var printedSessions = ImportDayLabels.Read(alternativePages).Values.Sum(labels => labels.Count);
        var weekGroups = schedule.Days.GroupBy(day => day.Week).ToList();
        if (weekGroups.Sum(week => week.Count()) != printedSessions || weekGroups.Count == 0) return (null, null);

        var counts = weekGroups.Select(week => week.Count()).Distinct().ToList();
        return (weekGroups.Count, counts.Count == 1 ? counts[0] : null);
    }

    /// About as many sessions as one read transcribes whole; see `ImportSections`.
    private const int SessionsPerSection = 8;

    /// The sections to read, from the printed page map rather than a model's outline: whole
    /// printed weeks, joined within one block up to about eight sessions. Each section runs to the
    /// page before the next one starts, so a table that runs onto an unlabelled page is still read.
    public List<ImportChunk> Chunks()
    {
        var weeks = days.GroupBy(day => day.Week).Select(week => week.ToList()).ToList();
        var groups = new List<List<List<SourceDay>>>();
        foreach (var week in weeks)
        {
            var last = groups.LastOrDefault();
            if (last is not null && last[0][0].Block == week[0].Block
                && last.Sum(item => item.Count) + week.Count <= SessionsPerSection) last.Add(week);
            else groups.Add([week]);
        }
        return groups.Select((group, index) =>
        {
            var first = group[0][0];
            var lastWeek = group[^1][0].Week;
            var pageTo = index + 1 < groups.Count ? groups[index + 1][0][0].Page - 1 : group[^1].Max(day => day.Page);
            var weekLabel = first.Week == lastWeek ? $"week {first.Week}" : $"weeks {first.Week}-{lastWeek}";
            return new ImportChunk(first.Block is null ? $"Printed {weekLabel}" : $"{first.Block}, {weekLabel}", first.Block, null,
                first.Week, lastWeek, first.Page, pageTo, group.Sum(week => week.Count + week.Sum(day => day.RestsAfter)));
        }).ToList();
    }

    /// Null unless every page that prints a day label also prints exactly one week heading, the
    /// weeks run on without a gap, a return to week one comes only under a new phase or block
    /// banner (an appendix that reprints week one is not a phase), no week is printed in lettered
    /// versions (see `ImportWeekVariants`), no page repeats a label, and no week holds more days
    /// than a program week can. A label repeated on another page of the same week is the book's
    /// own typo (BTS Beginner prints "Lower (Strength Focus)" twice in week one), not a version.
    public static ImportPrintedSchedule? Read(IReadOnlyList<ImportPageText> pages)
    {
        var output = new List<SourceDay>();
        string? block = null;
        var bannerSinceLast = false;
        var passedBlocks = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int? lastPrinted = null;
        string? lastLetter = null;
        var offset = 0;
        var phaseStart = 1;
        foreach (var page in pages.OrderBy(page => page.Page))
        {
            var lines = (page.Text ?? "").ReplaceLineEndings("\n").Split('\n').Select(line => line.Trim()).ToList();
            if (output.Count > 0 && lines.Any(line => AppendixHeading.IsMatch(line))) break;
            var banner = lines.Select(Banner).FirstOrDefault(value => value is not null);
            // Blocks only move forward: a banner naming one already left is a running header the
            // book never updated (Pure Bodybuilding Phase 2 keeps "BLOCK 1" atop block 2's pages).
            var blockChanged = banner is not null && !string.Equals(banner, block, StringComparison.OrdinalIgnoreCase)
                && !passedBlocks.Contains(banner);
            if (blockChanged)
            {
                if (block is not null) passedBlocks.Add(block);
                block = banner;
                bannerSinceLast = true;
            }
            var labels = lines.Select((line, index) => (Index: index, Found: ImportStructureHeadings.TryDayLabel(line, out var label), Label: label))
                .Where(item => item.Found).ToList();
            if (labels.Count == 0) continue;

            var (weeks, letter) = WeeksWithLetter(lines);
            if (weeks.Count != 1) return null;
            var printed = weeks[0];
            if (lastPrinted is null)
            {
                if (printed != 1) return null;
            }
            else if (printed == lastPrinted && letter is not null && lastLetter is not null && !string.Equals(letter, lastLetter, StringComparison.OrdinalIgnoreCase))
            {
                // Lettered version of same week (e.g. WEEK 10A followed by WEEK 10B): advance to a new week
                offset++;
            }
            else if (printed < lastPrinted)
            {
                // A restart is not evidence that the remaining pages are an appendix. Only a
                // source heading above can positively establish that boundary; otherwise leave
                // schedule discovery unresolved so the outline/read can explain the structure.
                if (printed != 1 || !bannerSinceLast) return null;
                offset = output[^1].Week;
                phaseStart = offset + 1;
            }
            else if (printed > lastPrinted + 1) return null;
            var week = offset + printed;
            if (bannerSinceLast && output.Count > 0) phaseStart = week;
            bannerSinceLast = false;
            lastPrinted = printed;
            lastLetter = letter;

            foreach (var (index, _, label) in labels)
            {
                var next = labels.Where(other => other.Index > index).Select(other => other.Index).DefaultIfEmpty(lines.Count).Min();
                var segment = lines.Skip(index + 1).Take(next - index - 1).ToList();
                var isRestSession = segment.Any(line => line.StartsWith("REST |", StringComparison.OrdinalIgnoreCase)
                    || line.Trim().Equals("NO PHYSICAL ACTIVITY", StringComparison.OrdinalIgnoreCase))
                    || Regex.IsMatch(label, @"^(?:REST|REST DAY|NO PHYSICAL ACTIVITY)$", RegexOptions.IgnoreCase);
                var rests = segment.Sum(RestCount);
                if (isRestSession)
                {
                    var restLabel = ImportDayLabels.TidyLabel(label.Replace('|', '/'));
                    output.Add(new SourceDay(page.Page, week, week - phaseStart + 1, block,
                        restLabel.Length == 0 ? "Rest Day" : restLabel, rests, IsRestDay: true));
                    continue;
                }

                var name = ImportDayLabels.TidyLabel(label.Replace('|', '/'));
                if (output.Any(day => day.Page == page.Page && Same(day.Label, name))) return null;
                output.Add(new SourceDay(page.Page, week, week - phaseStart + 1, block, name, rests));
            }
        }
        if (output.Count < 2 || output.GroupBy(day => day.Week).Any(group => group.Count() + group.Sum(day => day.RestsAfter) > ProgramLimits.MaxDaysPerWeek))
            return null;
        return new ImportPrintedSchedule(output);
    }

    /// Places the draft in printed order. Null workouts leave the draft as it was: when it holds a
    /// day on a page this schedule does not print, the schedule does not describe the whole draft,
    /// and when a page's days and labels cannot be paired review is told rather than guessed at.
    /// Days read from pages before the schedule begins print no day label and no week of the
    /// program: a warm-up routine read as "Week 1 day 1" is left out, and review says so.
    public (List<DraftWorkout>? Workouts, List<ImportReviewIssue> Notices) Reconcile(IReadOnlyList<DraftWorkout> draft)
    {
        var pages = days.Select(day => day.Page).ToHashSet();
        var lead = draft.TakeWhile(day => day.SourcePage is { } page && page < days[0].Page).ToList();
        var workouts = draft.Skip(lead.Count).ToList();
        var training = workouts.Where(day => !day.IsRestDay).ToList();
        if (training.Any(day => day.SourcePage is not { } page || !pages.Contains(page))
            || workouts.Any(day => day.IsRestDay && (day.SourcePage is not { } restPage || !pages.Contains(restPage))))
            return (null, []);

        var paired = new Dictionary<SourceDay, DraftWorkout>();
        foreach (var page in days.Where(day => !day.IsRestDay).GroupBy(day => day.Page))
        {
            var printed = page.ToList();
            var read = training.Where(day => day.SourcePage == page.Key).ToList();
            // More days than labels is a page whose labels do not name every table on it (Back
            // Hypertrophy titles three tables once); fewer is a printed session the read lacks.
            if (read.Count > printed.Count) return (null, []);
            if (read.Count < printed.Count)
                return (null, [new ImportReviewIssue("printed_schedule_mismatch",
                    $"PDF page {page.Key} prints {printed.Count} day{(printed.Count == 1 ? "" : "s")} but the read found {read.Count}, so the printed schedule was not applied. Check that page in review.",
                    "warning", page.Key)]);
            var byName = printed.All(day => read.Count(other => Same(other.Name, day.Label)) == 1);
            for (var index = 0; index < printed.Count; index++)
                paired[printed[index]] = byName ? read.Single(other => Same(other.Name, printed[index].Label)) : read[index];
        }

        var restsByPage = workouts.Where(day => day.IsRestDay).GroupBy(day => day.SourcePage!.Value)
            .ToDictionary(group => group.Key, group => new Queue<DraftWorkout>(group));
        var placed = new List<DraftWorkout>(workouts.Count);
        foreach (var source in days)
        {
            DraftWorkout? readRest = null;
            if (source.IsRestDay && restsByPage.TryGetValue(source.Page, out var sourceQueue) && sourceQueue.Count > 0)
                readRest = sourceQueue.Dequeue();
            var day = source.IsRestDay
                ? readRest ?? new DraftWorkout(Guid.NewGuid(), source.Week, "Rest Day", null, null, [], IsRestDay: true, SourcePage: source.Page)
                : paired[source];
            var block = source.Block ?? day.Block;
            var phase = source.Block is null ? day.Phase : null;
            var phaseWeek = source.Block is null ? day.PhaseWeek : source.PhaseWeek;
            placed.Add(day with { Week = source.Week, PhaseWeek = phaseWeek, Block = block, Phase = phase,
                Name = source.IsRestDay ? "Rest Day" : day.Name, Exercises = source.IsRestDay ? [] : day.Exercises,
                IsRestDay = source.IsRestDay, SourcePage = source.Page, BlockId = null, WeekId = null });
            for (var rest = 0; rest < source.RestsAfter; rest++)
            {
                var read = restsByPage.TryGetValue(source.Page, out var queue) && queue.Count > 0 ? queue.Dequeue() : null;
                placed.Add((read ?? new DraftWorkout(Guid.NewGuid(), source.Week, "Rest Day", null, null, [], IsRestDay: true, SourcePage: source.Page))
                    with { Week = source.Week, PhaseWeek = phaseWeek, Block = block, Phase = phase, Name = "Rest Day", Exercises = [], BlockId = null, WeekId = null });
            }
        }
        var unmatchedRest = restsByPage.Values.FirstOrDefault(queue => queue.Count > 0);
        if (unmatchedRest is not null)
            return (null, [new ImportReviewIssue("printed_schedule_mismatch",
                "The extraction found more rest sessions than the PDF schedule prints. Check the rest-day ordering in review.",
                "warning", unmatchedRest.Peek().SourcePage)]);
        if (days.All(day => day.Block is null)) placed = ImportValidation.NormalizePhaseWeeks(placed).Workouts;

        var notices = new List<ImportReviewIssue>();
        if (placed.Count != workouts.Count || placed.Where((day, index) => day.LineId != workouts[index].LineId || day.Week != workouts[index].Week).Any())
            notices.Add(new ImportReviewIssue("printed_schedule_used",
                $"{training.Count} days were placed in the weeks and slots the PDF prints, with a rest day wherever it prints a rest band.", "info"));
        if (lead.Count(day => !day.IsRestDay) is var left and > 0)
            notices.Add(new ImportReviewIssue("printed_schedule_lead_left_out",
                $"{left} day{(left == 1 ? " was" : "s were")} read from pages before the printed schedule, such as a warm-up routine, and left out of the program.",
                "info", lead[0].SourcePage));
        return (placed, notices);
    }

    private static int RestCount(string line)
    {
        var match = Regex.Match(line.Trim(), @"^(?:(?:SUGGESTED|MANDATORY|OPTIONAL)\s+)?(?<count>\d)\s*(?:[-–]\s*(?<max>\d)\s*)?\s*REST DAYS?", RegexOptions.IgnoreCase);
        if (match.Success && int.TryParse(match.Groups["count"].Value, out var n) && n > 0) return n;
        return ImportLongWeeks.RestBand.IsMatch(line) ? 1 : 0;
    }

    private static (List<int> Weeks, string? Letter) WeeksWithLetter(List<string> lines)
    {
        var weeks = new HashSet<int>();
        string? letter = null;
        for (var index = 0; index < lines.Count; index++)
        {
            var line = lines[index];
            var letMatch = Regex.Match(line, @"\bWEEK\s+\d+([A-Z])\b", RegexOptions.IgnoreCase);
            if (letMatch.Success) letter ??= letMatch.Groups[1].Value.ToUpperInvariant();

            if (ImportStructureHeadings.TryWeek(ImportStructureHeadings.LeadingSegment(line), out var week)) weeks.Add(week);
            else if (TitledWeek.Match(line) is { Success: true } titled)
            {
                weeks.Add(int.Parse(titled.Groups["week"].Value));
                if (titled.Groups["letter"].Success) letter ??= titled.Groups["letter"].Value.ToUpperInvariant();
            }
            // "WEEK" and its number printed as two stacked lines (Chest Hypertrophy's "WEEK / 01").
            else if (line.Equals("WEEK", StringComparison.OrdinalIgnoreCase) && index + 1 < lines.Count
                && BareNumber.IsMatch(lines[index + 1]) && int.Parse(lines[index + 1]) > 0) weeks.Add(int.Parse(lines[index + 1]));
        }
        return ([.. weeks], letter);
    }

    private static string? Banner(string line)
    {
        if (ImportStructureHeadings.TryBlock(line, out var label) && line.Length < 40) return $"Block {label}";
        return NamedBlock.IsMatch(line) ? ImportDayLabels.TidyLabel(line) : null;
    }

    private static bool Same(string left, string right)
        => Normalize(left) == Normalize(right);

    private static string Normalize(string value) => Regex.Replace(value, @"[^\p{L}\p{N}]", "").ToLowerInvariant();
}
