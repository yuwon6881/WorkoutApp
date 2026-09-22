using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// A document can print one week in lettered versions and ask for only one of them to be run:
/// Powerbuilding's "WEEK 10A" and "WEEK 10B" are two max-testing weeks, powerlifting or general
/// strength. A read numbers both "week 10", which puts two weeks of days — rest days included —
/// into one, overflowing the seven a week holds and pairing the options' rest days as repeats.
///
/// Each version is kept as a week of its own, in the order printed, and the weeks after it move
/// along to make room. Nothing is dropped: the reviewer is told which week is which and can pass
/// or delete the version they will not run.
internal static class ImportWeekVariants
{
    public const string Code = "week_versions_separated";

    /// A heading that names one lettered version and nothing else: a banner line, or one cell of
    /// a table header. Prose that mentions both versions ("choose either week 10A or week 10B")
    /// is not a heading and never decides which version a page holds.
    private static readonly Regex Heading = new(@"^WEEK\s*(?<week>\d{1,3})(?<version>[A-Z])$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public sealed record Result(List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices, HashSet<Guid> Moved);

    public static Result Separate(IReadOnlyList<DraftWorkout> days, IReadOnlyList<ImportPageText> pages)
    {
        var versions = PageVersions(pages);
        var workouts = days.ToList();
        var notices = new List<ImportReviewIssue>();
        var moved = new HashSet<Guid>();
        if (versions.Count == 0) return new Result(workouts, notices, moved);

        // Weeks move while this runs, so the bound is read afresh and a separated week is stepped over.
        for (var week = workouts.Min(day => day.Week); week <= workouts.Max(day => day.Week); week++)
        {
            var labelled = Label(workouts, week, versions);
            var order = labelled.Select(item => item.Version).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (order.Count < 2) continue;

            // Later weeks move first so a version's new number is never one a later week holds.
            var extra = order.Count - 1;
            var laterWeeks = workouts.Any(day => day.Week > week);
            workouts = workouts.Select(day => day.Week > week ? Renumber(day, day.Week + extra) : day).ToList();
            var byLine = labelled.ToDictionary(item => item.Day.LineId, item => item.Version);
            workouts = workouts.Select(day =>
            {
                if (day.Week != week || !byLine.TryGetValue(day.LineId, out var version) || version is null) return day;
                var offset = order.FindIndex(item => string.Equals(item, version, StringComparison.OrdinalIgnoreCase));
                if (offset <= 0) return day;
                moved.Add(day.LineId);
                return Renumber(day, week + offset);
            }).ToList();
            var first = labelled.First(item => item.Version is not null);
            var names = order.Select(version => $"{week}{version.ToUpperInvariant()}").ToList();
            notices.Add(new ImportReviewIssue(Code,
                $"Week {week} is printed in {order.Count} versions ({string.Join(", ", names)}) that the document offers as a choice. " +
                $"Each was kept as its own week — weeks {string.Join(", ", Enumerable.Range(week, order.Count))} — so pass or delete the version you will not run." +
                (laterWeeks ? " Later weeks were moved along to make room." : ""),
                "info", first.Day.SourcePage, first.Day.LineId, TargetField: "week"));
            week += extra;
        }
        return new Result(workouts, notices, moved);
    }

    /// Which version each day of a week belongs to. A day cites its page; a day that cites none
    /// (a rest day read without one) belongs with the day printed before it.
    private static List<(DraftWorkout Day, string? Version)> Label(List<DraftWorkout> workouts, int week, Dictionary<int, (int Week, string Version)> versions)
    {
        var labelled = new List<(DraftWorkout Day, string? Version)>();
        string? current = null;
        foreach (var day in workouts.Where(day => day.Week == week))
        {
            var page = day.SourcePage ?? day.Exercises.Select(exercise => exercise.SourcePage).FirstOrDefault(value => value is not null);
            if (page is { } number && versions.TryGetValue(number, out var printed) && printed.Week == week) current = printed.Version;
            else if (page is not null) current = null;
            labelled.Add((day, current));
        }
        return labelled;
    }

    /// Pages whose headings name exactly one lettered version of one week.
    private static Dictionary<int, (int Week, string Version)> PageVersions(IReadOnlyList<ImportPageText> pages)
    {
        var versions = new Dictionary<int, (int Week, string Version)>();
        foreach (var page in pages)
        {
            var headings = (page.Text ?? "").ReplaceLineEndings("\n").Split('\n')
                .SelectMany(line => line.Split('|'))
                .Select(cell => Heading.Match(Regex.Replace(cell.Trim(), @"\s+", " ")))
                .Where(match => match.Success)
                .Select(match => (Week: int.Parse(match.Groups["week"].Value), Version: match.Groups["version"].Value.ToUpperInvariant()))
                .Distinct().ToList();
            if (headings.Count == 1) versions[page.Page] = headings[0];
        }
        return versions;
    }

    private static DraftWorkout Renumber(DraftWorkout day, int week)
        => day with { Week = week, PhaseWeek = day.PhaseWeek > 0 ? day.PhaseWeek + (week - day.Week) : day.PhaseWeek };
}
