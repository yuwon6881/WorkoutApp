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
    /// A week heading after a running title: "PROGRAM: WEEK 1", "... | WEEK 1 (BLOCK 1)".
    private static readonly Regex TitledWeek = new(@"(?:^|[:|/]\s*)WEEK\s+0?(?<week>\d{1,2})(?=\s*(?:$|\(|\|))", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    internal sealed record SourceDay(int Page, int Week, int PhaseWeek, string? Block, string Label, int RestsAfter);

    private readonly List<SourceDay> days;
    private ImportPrintedSchedule(List<SourceDay> days) => this.days = days;

    public IReadOnlyList<SourceDay> Days => days;

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
        int? lastPrinted = null;
        var offset = 0;
        var phaseStart = 1;
        foreach (var page in pages.OrderBy(page => page.Page))
        {
            var lines = (page.Text ?? "").ReplaceLineEndings("\n").Split('\n').Select(line => line.Trim()).ToList();
            if (lines.Any(line => LetteredWeek.IsMatch(line))) return null;
            var banner = lines.Select(Banner).FirstOrDefault(value => value is not null);
            var blockChanged = banner is not null && !string.Equals(banner, block, StringComparison.OrdinalIgnoreCase);
            if (blockChanged) { block = banner; bannerSinceLast = true; }
            var labels = lines.Select((line, index) => (Index: index, Found: ImportStructureHeadings.TryDayLabel(line, out var label), Label: label))
                .Where(item => item.Found).ToList();
            if (labels.Count == 0) continue;

            var weeks = Weeks(lines);
            if (weeks.Count != 1) return null;
            var printed = weeks[0];
            if (lastPrinted is null)
            {
                if (printed != 1) return null;
            }
            else if (printed < lastPrinted)
            {
                if (printed != 1 || !bannerSinceLast) return null;
                offset = output[^1].Week;
                phaseStart = offset + 1;
            }
            else if (printed > lastPrinted + 1) return null;
            var week = offset + printed;
            if (bannerSinceLast && output.Count > 0) phaseStart = week;
            bannerSinceLast = false;
            lastPrinted = printed;

            foreach (var (index, _, label) in labels)
            {
                var name = ImportDayLabels.TidyLabel(label.Replace('|', '/'));
                if (output.Any(day => day.Page == page.Page && Same(day.Label, name))) return null;
                // A band belongs to the session it is printed under: after this label and before the next.
                var next = labels.Where(other => other.Index > index).Select(other => other.Index).DefaultIfEmpty(lines.Count).Min();
                var rests = lines.Skip(index + 1).Take(next - index - 1).Count(line => ImportLongWeeks.RestBand.IsMatch(line));
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
    /// Days read from pages before the schedule begins (a warm-up day) keep their place in front.
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
        foreach (var page in days.GroupBy(day => day.Page))
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
            var day = paired[source];
            var block = source.Block ?? day.Block;
            var phase = source.Block is null ? day.Phase : null;
            var phaseWeek = source.Block is null ? day.PhaseWeek : source.PhaseWeek;
            placed.Add(day with { Week = source.Week, PhaseWeek = phaseWeek, Block = block, Phase = phase, BlockId = null, WeekId = null });
            for (var rest = 0; rest < source.RestsAfter; rest++)
            {
                var read = restsByPage.TryGetValue(source.Page, out var queue) && queue.Count > 0 ? queue.Dequeue() : null;
                placed.Add((read ?? new DraftWorkout(Guid.NewGuid(), source.Week, "Rest Day", null, null, [], IsRestDay: true, SourcePage: source.Page))
                    with { Week = source.Week, PhaseWeek = phaseWeek, Block = block, Phase = phase, Name = "Rest Day", Exercises = [], BlockId = null, WeekId = null });
            }
        }
        placed.InsertRange(0, lead);
        if (days.All(day => day.Block is null)) placed = ImportValidation.NormalizePhaseWeeks(placed).Workouts;

        var moved = placed.Count != draft.Count || placed.Where((day, index) => day.LineId != draft[index].LineId
            || day.Week != draft[index].Week).Any();
        return (placed, moved
            ? [new ImportReviewIssue("printed_schedule_used",
                $"{training.Count} days were placed in the weeks and slots the PDF prints, with a rest day wherever it prints a rest band.", "info")]
            : []);
    }

    private static List<int> Weeks(List<string> lines)
    {
        var weeks = new HashSet<int>();
        for (var index = 0; index < lines.Count; index++)
        {
            if (ImportStructureHeadings.TryWeek(ImportStructureHeadings.LeadingSegment(lines[index]), out var week)) weeks.Add(week);
            else if (TitledWeek.Match(lines[index]) is { Success: true } titled) weeks.Add(int.Parse(titled.Groups["week"].Value));
            // "WEEK" and its number printed as two stacked lines (Chest Hypertrophy's "WEEK / 01").
            else if (lines[index].Equals("WEEK", StringComparison.OrdinalIgnoreCase) && index + 1 < lines.Count
                && BareNumber.IsMatch(lines[index + 1]) && int.Parse(lines[index + 1]) > 0) weeks.Add(int.Parse(lines[index + 1]));
        }
        return [.. weeks];
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
