using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// <summary>
/// Reconciles source-confirmed long training cycles into the app's seven-day weeks. A printed
/// ten-day rotation is divided as 7+3 in page order, so rests and block banners cannot move its
/// sessions across cycle boundaries.
/// </summary>
internal static class ImportLongWeeks
{
    private static readonly Regex DayLabel = new(@"(?m)^\s*DAY LABEL:\s*(?<name>[^\r\n]+)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex TenDayCycle = new(
        @"\basynchronous\s+(?:split|rotation|schedule)\b.{0,200}\b10[- ]day cycle\b|\b10[- ]day cycle\b.{0,200}\basynchronous\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Singleline);
    private static readonly Regex RestBand = new(
        @"^\s*\d\s*(?:[-–]\s*\d\s*)?REST DAYS?\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public sealed record Result(List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices);

    /// A source-confirmed asynchronous cycle may span chunks before the final schedule exists.
    /// Chunk reconciliation must leave its rest bands intact for the final page-ordered pass.
    public static bool IsTenDayCycleSource(IReadOnlyList<ImportPageText> pages)
        => pages.Any(page => TenDayCycle.IsMatch(page.Text ?? ""));

    public static Result Reconcile(IReadOnlyList<DraftWorkout> workouts, IReadOnlyList<ImportPageText> pages)
    {
        if (IsTenDayCycleSource(pages) && TryReconcileTenDayCycles(workouts, pages, out var cycleResult))
            return cycleResult;

        return ReconcileOtherLongWeeks(workouts, pages);
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

        var mapped = new List<DraftWorkout>(workouts.Count);
        for (var cycleIndex = 0; cycleIndex < orderedCycles.Count; cycleIndex++)
        {
            var cycleDays = orderedCycles[cycleIndex];
            var firstAppWeek = cycleIndex * 2 + 1;
            for (var dayIndex = 0; dayIndex < cycleDays.Count; dayIndex++)
            {
                var appWeek = firstAppWeek + (dayIndex >= 7 ? 1 : 0);
                mapped.Add(cycleDays[dayIndex].Day with { Week = appWeek });
            }
        }

        // Phase weeks count forward within each contiguous source block/phase. Using the newly
        // assigned app week here keeps the 7-day and 3-day portions distinct even when a block's
        // printed phase-week counter restarts or a recycled banner interrupts it.
        mapped = NumberPhaseWeeks(mapped);
        var appWeeks = mapped.Select(day => day.Week).Distinct().Order().ToList();
        if (!appWeeks.SequenceEqual(Enumerable.Range(1, cycles.Count * 2)) ||
            mapped.GroupBy(day => day.Week).Any(week => week.Count() > 7))
            return false;

        var firstPage = mapped.Select(day => day.SourcePage).FirstOrDefault(page => page.HasValue);
        result = new Result(mapped,
        [
            new ImportReviewIssue("long_source_cycle_reflowed",
                $"The PDF defines {cycles.Count} ten-day training cycles. Each was scheduled across two app weeks (7 days, then 3), preserving its printed order and rest days.",
                "info", firstPage, TargetField: "week")
        ]);
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
                .Select(match => match.Groups["name"].Value.Trim())).ToHashSet(StringComparer.OrdinalIgnoreCase));
        var ordered = workouts.Select((day, index) => (Day: day, Index: index))
            .OrderBy(item => item.Day.Week).ThenBy(item => item.Index).Select(item => item.Day).ToList();
        var result = new List<DraftWorkout>(ordered.Count);
        var notices = new List<ImportReviewIssue>();
        var offset = 0;

        foreach (var phase in ImportValidation.GroupDraftPhases(ordered))
        {
            var weeks = phase.GroupBy(day => day.Week).ToList();
            var longWeeks = weeks.Where(week => SourceConfirmsLongWeek(week.ToList(), sourceLabels)).ToList();
            if (longWeeks.Count != weeks.Count ||
                !weeks.Select((week, index) => week.Key == weeks[0].Key + index).All(value => value))
            {
                result.AddRange(phase.Select(day => day with { Week = day.Week + offset }));
                continue;
            }

            var firstWeek = phase.Min(day => day.Week) + offset;
            for (var index = 0; index < phase.Count; index++)
                result.Add(phase[index] with { Week = firstWeek + index / 7, PhaseWeek = 1 + index / 7 });
            var appWeeks = (phase.Count + 6) / 7;
            offset += appWeeks - weeks.Count;
            var first = longWeeks[0].First();
            notices.Add(new ImportReviewIssue("long_source_week_reflowed",
                $"This PDF prints more than seven distinct training days in a week. The {phase.Count} days in this section, including rest days, were kept in source order across {appWeeks} seven-day program weeks.",
                "info", first.SourcePage, first.LineId, TargetField: "week"));
        }

        return new Result(result, notices);
    }

    private static bool SourceConfirmsLongWeek(IReadOnlyList<DraftWorkout> days,
        IReadOnlyDictionary<int, HashSet<string>> sourceLabels)
    {
        if (days.Count <= 7) return false;
        var training = days.Where(day => !day.IsRestDay).ToList();
        if (training.Select(day => (day.SourcePage, Name: day.Name.Trim().ToUpperInvariant())).Distinct().Count() <= 7)
            return false;
        return training.All(day => day.SourcePage is { } page &&
            sourceLabels.TryGetValue(page, out var labels) && labels.Contains(day.Name.Trim()));
    }
}
