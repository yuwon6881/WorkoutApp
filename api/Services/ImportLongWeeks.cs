using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// <summary>
/// Reconciles source-confirmed long training cycles. A week the PDF prints with more than seven
/// days (an asynchronous ten-day rotation) keeps its printed week number and page order, so rests
/// and block banners cannot move its sessions across cycle boundaries.
/// </summary>
internal static class ImportLongWeeks
{
    private const int MaxDays = Workout.Api.Domain.ProgramLimits.MaxDaysPerWeek;
    private static readonly Regex DayLabel = new(@"(?m)^\s*DAY LABEL:\s*(?<name>[^\r\n]+)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex TenDayCycle = new(
        @"\b10[- ]day\s+(?:cycle|rotation|split)\b|\basynchronous\b.{0,200}\b10[- ]day\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Singleline);
    internal static readonly Regex RestBand = new(
        @"^\s*(?:(?:SUGGESTED|MANDATORY|OPTIONAL)\s+)?(?:\d\s*(?:[-–]\s*\d\s*)?\s*)?REST DAYS?\s*$|^\s*\d\s*(?:[-–]\s*\d\s*)?\s*(?:SUGGESTED|MANDATORY|OPTIONAL)\s+REST DAYS?\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// SourceWeekDays is the longest week the source confirms, when that is longer than seven days.
    public sealed record Result(List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices, int? SourceWeekDays = null);

    /// A source-confirmed asynchronous cycle may span chunks before the final schedule exists.
    /// Chunk reconciliation must leave its rest bands intact for the final page-ordered pass.
    public static bool IsTenDayCycleSource(IReadOnlyList<ImportPageText> pages)
        => pages.Any(page => TenDayCycle.IsMatch(page.Text ?? ""));

    public static bool HasSourceLongWeek(IReadOnlyList<ImportPageText> pages)
    {
        var counts = new Dictionary<(int Run, int Week), int>();
        int? currentWeek = null;
        var currentBlock = "";
        var run = 0;
        foreach (var page in pages.OrderBy(page => page.Page))
        {
            var lines = (page.Text ?? "").ReplaceLineEndings("\n").Split('\n');
            var blocks = lines.Select(line => ImportStructureHeadings.LeadingSegment(line))
                .Select(line => ImportStructureHeadings.TryBlock(line, out var block) ? block : null)
                .Where(block => block is not null).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (blocks.Count == 1 && !blocks[0]!.Equals(currentBlock, StringComparison.OrdinalIgnoreCase))
            {
                currentBlock = blocks[0]!;
                run++;
            }
            var headings = lines.Select(line => ImportStructureHeadings.LeadingSegment(line))
                .Select(line => ImportStructureHeadings.TryWeek(line, out var week) ? (int?)week : null)
                .OfType<int>().Distinct().ToList();
            if (headings.Count > 1) { currentWeek = null; continue; }
            if (headings.Count == 1)
            {
                if (currentWeek is { } prior && headings[0] < prior && blocks.Count == 0) run++;
                currentWeek = headings[0];
            }
            if (currentWeek is not { } number) continue;
            var key = (run, number);
            counts[key] = counts.GetValueOrDefault(key) + lines.Count(line =>
                DayLabel.IsMatch(line) || RestBand.IsMatch(line) ||
                line.Trim().Equals("REST DAY", StringComparison.OrdinalIgnoreCase));
            if (counts[key] > 7) return true;
        }
        return false;
    }

    public static Result Reconcile(IReadOnlyList<DraftWorkout> workouts, IReadOnlyList<ImportPageText> pages)
    {
        if (IsTenDayCycleSource(pages) && TryReconcileTenDayCycles(workouts, pages, out var cycleResult))
            return cycleResult;

        var optional = ImportOptionalScheduleDays.Reconcile(workouts, pages);
        var weeks = ReconcileOtherLongWeeks(optional.Workouts, pages);
        var numbered = ImportValidation.NormalizePhaseWeeks(weeks.Workouts);
        var notices = new List<ImportReviewIssue>(optional.Notices);
        notices.AddRange(weeks.Notices);
        if (numbered.Renumbered)
            notices.Add(new ImportReviewIssue("phase_week_renumbered",
                "Phase week numbers were normalized after source-backed schedule placement; program weeks are unchanged.",
                "info", optional.Notices.FirstOrDefault()?.SourcePage));
        return new Result(numbered.Workouts, notices, weeks.SourceWeekDays);
    }

    private static bool TryReconcileTenDayCycles(IReadOnlyList<DraftWorkout> workouts,
        IReadOnlyList<ImportPageText> pages, out Result result)
    {
        result = new Result(workouts.ToList(), []);
        var labelsByPage = ImportDayLabels.Read(pages);
        if (labelsByPage.Count == 0) return false;

        var cycles = ReadSourceCycles(pages, labelsByPage);
        if (cycles.Count < 2 || cycles[0].PrintedWeek != 1 ||
            cycles.Select((cycle, index) => cycle.PrintedWeek == index + 1).Any(isSequential => !isSequential))
            return false;

        // The schedule text is explicit about its ten-day length. These source checks make sure
        // it is the eight printed training tables and two rest bands that define each cycle.
        if (cycles.Any(cycle => cycle.TrainingLabels.Count != 8 || cycle.RestBandPages.Count != 2)) return false;
        var indexedDays = workouts.Select((day, index) => (Day: day, Index: index, Page: SourcePage(day))).ToList();
        var byCycle = cycles.Select(_ => new List<(DraftWorkout Day, int Index, int Page)>()).ToList();
        foreach (var item in indexedDays)
        {
            if (item.Page is not { } page || !cycles.PageToCycle.TryGetValue(page, out var cycleIndex)) return false;
            byCycle[cycleIndex].Add((item.Day, item.Index, page));
        }

        var orderedCycles = new List<List<(DraftWorkout Day, int Index, int Page)>>(cycles.Count);
        foreach (var (cycle, index) in cycles.Select((cycle, index) => (cycle, index)))
        {
            var days = byCycle[index].OrderBy(item => item.Page).ThenBy(item => item.Index).ToList();
            if (days.Count != 10 || days.Count(day => !day.Day.IsRestDay) != cycle.TrainingLabels.Count ||
                days.Count(day => day.Day.IsRestDay) != cycle.RestBandPages.Count)
                return false;

            // Each printed title belongs to exactly one extracted session on its page. A row
            // without a page citation or a missing title is left for review instead of guessed.
            foreach (var (page, pageLabels) in cycle.TrainingLabels)
                if (days.Count(day => !day.Day.IsRestDay && day.Page == page) != pageLabels.Count) return false;

            orderedCycles.Add(days);
        }

        // Each printed cycle is one program week, as the PDF numbers it.
        var mapped = new List<DraftWorkout>(workouts.Count);
        for (var cycleIndex = 0; cycleIndex < orderedCycles.Count; cycleIndex++)
            mapped.AddRange(orderedCycles[cycleIndex].Select(item => item.Day with { Week = cycleIndex + 1 }));

        // Phase weeks count forward within each contiguous source block/phase, even when a block's
        // printed phase-week counter restarts or a recycled banner interrupts it.
        mapped = NumberPhaseWeeks(mapped);
        var appWeeks = mapped.Select(day => day.Week).Distinct().Order().ToList();
        if (!appWeeks.SequenceEqual(Enumerable.Range(1, cycles.Count)) ||
            mapped.GroupBy(day => day.Week).Any(week => week.Count() > MaxDays))
            return false;

        var firstPage = mapped.Select(day => day.SourcePage).FirstOrDefault(page => page.HasValue);
        result = new Result(mapped,
        [
            new ImportReviewIssue("long_source_cycle_reflowed",
                $"The PDF runs on a ten-day cycle, so each of its {cycles.Count} printed weeks keeps all ten days in printed order, rest days included.",
                "info", firstPage, TargetField: "week")
        ], mapped.GroupBy(day => day.Week).Max(week => week.Count()));
        return true;
    }

    private sealed record SourceCycle(int PrintedWeek, Dictionary<int, List<string>> TrainingLabels,
        List<int> RestBandPages);

    private sealed class SourceCycles(List<SourceCycle> cycles, Dictionary<int, int> pageToCycle)
        : List<SourceCycle>(cycles)
    {
        public Dictionary<int, int> PageToCycle { get; } = pageToCycle;
    }

    private static SourceCycles ReadSourceCycles(IReadOnlyList<ImportPageText> pages,
        IReadOnlyDictionary<int, List<string>> labelsByPage)
    {
        var cycles = new List<SourceCycle>();
        var pageToCycle = new Dictionary<int, int>();
        int? currentWeek = null;
        var activeCycle = -1;
        foreach (var page in pages.OrderBy(page => page.Page))
        {
            var footer = false;
            foreach (var line in (page.Text ?? "").ReplaceLineEndings("\n").Split('\n'))
            {
                var leading = ImportStructureHeadings.LeadingSegment(line);
                if (ImportStructureHeadings.TryWeek(leading, out var week)) currentWeek = week;
                if (RestBand.IsMatch(line)) footer = true;
            }

            if (labelsByPage.TryGetValue(page.Page, out var labels))
            {
                if (currentWeek is null) return new SourceCycles([], []);
                if (activeCycle < 0 || cycles[activeCycle].PrintedWeek != currentWeek.Value)
                {
                    cycles.Add(new SourceCycle(currentWeek.Value, [], []));
                    activeCycle = cycles.Count - 1;
                }
                cycles[activeCycle].TrainingLabels[page.Page] = labels;
            }

            if (activeCycle >= 0)
            {
                pageToCycle[page.Page] = activeCycle;
                if (footer && currentWeek == cycles[activeCycle].PrintedWeek)
                    cycles[activeCycle].RestBandPages.Add(page.Page);
            }
        }

        return new SourceCycles(cycles, pageToCycle);
    }

    private static List<DraftWorkout> NumberPhaseWeeks(IReadOnlyList<DraftWorkout> workouts)
    {
        var result = new List<DraftWorkout>(workouts.Count);
        string? previousBlock = null;
        string? previousPhase = null;
        var previousWeek = 0;
        var phaseWeek = 0;
        foreach (var day in workouts)
        {
            var block = ImportValidation.CanonicalBlock(day.Block);
            var phase = day.Phase?.Trim() ?? "";
            var samePhase = string.Equals(previousBlock, block, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(previousPhase, phase, StringComparison.OrdinalIgnoreCase);
            if (!samePhase) phaseWeek = 1;
            else if (day.Week != previousWeek) phaseWeek++;

            result.Add(day with { PhaseWeek = phaseWeek });
            previousBlock = block;
            previousPhase = phase;
            previousWeek = day.Week;
        }
        return result;
    }

    private static int? SourcePage(DraftWorkout day)
    {
        if (day.SourcePage.HasValue) return day.SourcePage;
        var pages = day.Exercises.SelectMany(exercise => new int?[] { exercise.SourcePage }
                .Concat(exercise.Sets.Select(set => set.SourcePage)))
            .Where(page => page.HasValue).Select(page => page.GetValueOrDefault()).Distinct().Take(2).ToList();
        return pages.Count == 1 ? pages[0] : null;
    }

    private static Result ReconcileOtherLongWeeks(IReadOnlyList<DraftWorkout> workouts,
        IReadOnlyList<ImportPageText> pages)
    {
        var sourceLabels = pages.GroupBy(page => page.Page).ToDictionary(group => group.Key,
            group => group.SelectMany(page => DayLabel.Matches(page.Text ?? "")
                .Select(match => match.Groups["name"].Value.Trim())).ToList());
        var sourceRests = pages.GroupBy(page => page.Page).ToDictionary(group => group.Key,
            group => group.Sum(page => (page.Text ?? "").ReplaceLineEndings("\n").Split('\n')
                .Count(line => RestBand.IsMatch(line) || line.Trim().Equals("REST DAY", StringComparison.OrdinalIgnoreCase))));
        var ordered = workouts.Select((day, index) => (Day: day, Index: index))
            .OrderBy(item => item.Day.Week).ThenBy(item => item.Index).Select(item => item.Day).ToList();
        var result = new List<DraftWorkout>(ordered.Count);
        var notices = new List<ImportReviewIssue>();
        var offset = 0;
        int? longest = null;

        foreach (var phase in ImportValidation.GroupDraftPhases(ordered))
        {
            foreach (var week in phase.GroupBy(day => day.Week))
            {
                var days = week.ToList();
                var firstWeek = week.Key + offset;
                if (!SourceConfirmsLongWeek(days, sourceLabels, sourceRests))
                {
                    result.AddRange(days.Select(day => day with { Week = firstWeek }));
                    continue;
                }

                if (days.Count <= MaxDays)
                {
                    // The printed week is kept whole: its week number is the PDF's own.
                    result.AddRange(days.Select(day => day with { Week = firstWeek }));
                    longest = Math.Max(longest ?? 0, days.Count);
                    notices.Add(new ImportReviewIssue("long_source_week_kept",
                        $"This PDF prints {days.Count} days in week {week.Key}; the week was kept as printed, rest days included.",
                        "info", days[0].SourcePage, days[0].LineId, TargetField: "week"));
                    continue;
                }

                // Beyond two weeks' worth of days, the week cannot be stored whole and is split in order.
                for (var index = 0; index < days.Count; index++)
                    result.Add(days[index] with { Week = firstWeek + index / MaxDays,
                        PhaseWeek = days[index].PhaseWeek + index / MaxDays });
                var appWeeks = (days.Count + MaxDays - 1) / MaxDays;
                offset += appWeeks - 1;
                longest = MaxDays;
                notices.Add(new ImportReviewIssue("long_source_week_reflowed",
                    $"This PDF prints {days.Count} distinct slots in week {week.Key}. All training and rest slots were kept in source order across {appWeeks} app weeks.",
                    "info", days[0].SourcePage, days[0].LineId, TargetField: "week"));
            }
        }

        return new Result(result, notices, longest);
    }

    private static bool SourceConfirmsLongWeek(IReadOnlyList<DraftWorkout> days,
        IReadOnlyDictionary<int, List<string>> sourceLabels,
        IReadOnlyDictionary<int, int> sourceRests)
    {
        if (days.Count <= 7) return false;
        var training = days.Where(day => !day.IsRestDay).ToList();
        if (training.Count == 0 || training.Any(day => day.SourcePage is null) ||
            days.Where(day => day.IsRestDay).Any(day => day.SourcePage is null)) return false;
        foreach (var group in training.GroupBy(day => day.SourcePage!.Value))
        {
            if (!sourceLabels.TryGetValue(group.Key, out var labels)) return false;
            var remaining = new List<string>(labels);
            foreach (var day in group)
            {
                var index = remaining.FindIndex(label => label.Equals(day.Name.Trim(), StringComparison.OrdinalIgnoreCase));
                if (index < 0) return false;
                remaining.RemoveAt(index);
            }
            if (remaining.Count != 0) return false;
        }
        foreach (var group in days.Where(day => day.IsRestDay).GroupBy(day => day.SourcePage!.Value))
            if (!sourceRests.TryGetValue(group.Key, out var count) || group.Count() > count) return false;
        return true;
    }
}
