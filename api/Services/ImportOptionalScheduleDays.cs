using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// <summary>
/// Places a separately printed workout into the exact weeks named by its optional schedule note.
/// </summary>
internal static class ImportOptionalScheduleDays
{
    private static readonly Regex WeekSchedule = new(
        @"\bOPTIONALLY\s+RUN\s+THIS\s+DAY\s+ON\s+(?:(?:THE\s+)?(?:ODD|EVEN)\s+)?WEEKS?\s*\((?<weeks>[^)]*)\)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex WeekNumber = new(@"\b(?<week>\d{1,3})\b",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public sealed record Result(List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices);

    internal static List<int> ScheduledWeeks(string text)
    {
        var schedules = WeekSchedule.Matches(Regex.Replace(text, @"\s+", " "));
        return schedules.Count == 1
            ? WeekNumber.Matches(schedules[0].Groups["weeks"].Value)
                .Select(match => int.Parse(match.Groups["week"].Value)).Distinct().ToList()
            : [];
    }

    public static Result Reconcile(IReadOnlyList<DraftWorkout> workouts, IReadOnlyList<ImportPageText> pages)
    {
        var result = workouts.ToList();
        var notices = new List<ImportReviewIssue>();
        foreach (var page in pages.OrderBy(page => page.Page))
        {
            var weeks = ScheduledWeeks(page.Text ?? "");
            var labels = ImportDayLabels.Read([page]).GetValueOrDefault(page.Page) ?? [];
            if (weeks.Count == 0 || weeks.Any(week => week is < 1 or > 104) || labels.Count != 1) continue;

            var targetName = Identity(labels[0]);
            var matches = result.Select((workout, index) => (workout, index))
                .Where(item => !item.workout.IsRestDay && SourcePage(item.workout) == page.Page &&
                    Identity(item.workout.Name) == targetName)
                .ToList();
            if (matches.Count != 1) continue;

            var (source, sourceIndex) = matches[0];
            if (weeks.Count == 1 && weeks[0] == source.Week) continue;

            var weekList = string.Join(", ", weeks);
            var note = $"Optional session printed for weeks {weekList}.";
            var notes = AppendNote(source.Notes, note);
            var copies = weeks.Select((week, index) =>
            {
                // A placed copy belongs to the week it joins. The page that prints the optional day
                // can sit inside another phase — a deload week printed just before it — and an
                // unnamed phase in the target week is that week's phase, not a gap to fill from
                // the source page.
                var context = WeekContext(source, week, workouts);
                var placed = source with
                {
                    Week = week,
                    PhaseWeek = context?.PhaseWeek ?? source.PhaseWeek,
                    Block = context is null ? source.Block : context.Block,
                    Phase = context is null ? source.Phase : context.Phase,
                    BlockId = context?.BlockId,
                    WeekId = context?.WeekId,
                    Notes = notes
                };
                return index == 0 ? placed : Clone(placed, week, notes);
            }).ToList();
            result.RemoveAt(sourceIndex);
            result.InsertRange(sourceIndex, copies);
            notices.Add(new ImportReviewIssue("optional_source_day_scheduled",
                $"The PDF assigns this optional day to weeks {weekList}; it was placed in each listed week.",
                "info", page.Page, copies[0].LineId, TargetField: "week"));
        }

        return new Result(result, notices);
    }

    private static DraftWorkout Clone(DraftWorkout source, int week, string? notes)
        => source with
        {
            LineId = Guid.NewGuid(),
            Week = week,
            Notes = notes,
            Exercises = source.Exercises.Select(exercise => exercise with
            {
                LineId = Guid.NewGuid(),
                Sets = exercise.Sets.ToList(),
                Substitutions = exercise.Substitutions?.ToList(),
                DemoLinks = exercise.DemoLinks is null ? null : new Dictionary<string, string>(exercise.DemoLinks)
            }).ToList()
        };

    private static DraftWorkout? WeekContext(DraftWorkout source, int week, IReadOnlyList<DraftWorkout> workouts)
    {
        var candidates = workouts.Where(day => day.Week == week && !day.IsRestDay).ToList();
        return candidates.FirstOrDefault(day => Same(day.Block, source.Block) && Same(day.Phase, source.Phase))
            ?? candidates.FirstOrDefault(day => Same(day.Block, source.Block))
            ?? candidates.FirstOrDefault();
    }

    private static bool Same(string? left, string? right)
        => string.Equals(left?.Trim() ?? "", right?.Trim() ?? "", StringComparison.OrdinalIgnoreCase);

    private static int? SourcePage(DraftWorkout workout)
    {
        if (workout.SourcePage.HasValue) return workout.SourcePage;
        var pages = workout.Exercises.SelectMany(exercise => new int?[] { exercise.SourcePage }
                .Concat(exercise.Sets.Select(set => set.SourcePage)))
            .Where(page => page.HasValue).Select(page => page.GetValueOrDefault()).Distinct().Take(2).ToList();
        return pages.Count == 1 ? pages[0] : null;
    }

    private static string Identity(string value)
        => Regex.Replace(value.Trim(), @"[^\p{L}\p{N}]+", " ").Trim().ToUpperInvariant();

    private static string AppendNote(string? existing, string note)
        => string.IsNullOrWhiteSpace(existing) ? note
            : existing.Contains(note, StringComparison.OrdinalIgnoreCase) ? existing
            : $"{existing.Trim()} {note}";
}
