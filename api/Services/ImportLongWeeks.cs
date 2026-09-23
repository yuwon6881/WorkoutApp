using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// <summary>
/// Some PDFs call a ten-day rotation a week. Keep every printed day, but place the
/// rotation into the seven-day weeks that a program can actually schedule.
/// </summary>
internal static class ImportLongWeeks
{
    private static readonly Regex DayLabel = new(@"(?m)^\s*DAY LABEL:\s*(?<name>[^\r\n]+)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public sealed record Result(List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices);

    public static Result Reconcile(IReadOnlyList<DraftWorkout> workouts, IReadOnlyList<ImportPageText> pages)
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
            // A mixed phase may contain a stray extra row. Repacking that phase could
            // collapse otherwise valid printed weeks and conceal missing source days.
            if (longWeeks.Count != weeks.Count ||
                !weeks.Select((week, index) => week.Key == weeks[0].Key + index).All(value => value))
            {
                result.AddRange(phase.Select(day => day with { Week = day.Week + offset }));
                continue;
            }

            // Every source week in this phase belongs to the same running rotation. Packing
            // each separately would add a short app week after every printed ten-day cycle.
            var firstWeek = phase.Min(day => day.Week) + offset;
            for (var index = 0; index < phase.Count; index++)
                result.Add(phase[index] with
                {
                    Week = firstWeek + index / 7,
                    PhaseWeek = 1 + index / 7
                });
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
        // Repeated names on different printed pages are still separate sessions in a rotation.
        if (training.Select(day => (day.SourcePage, Name: day.Name.Trim().ToUpperInvariant())).Distinct().Count() <= 7)
            return false;
        return training.All(day => day.SourcePage is { } page &&
            sourceLabels.TryGetValue(page, out var labels) && labels.Contains(day.Name.Trim()));
    }
}
