using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Programs often print a general warm-up routine as a table before the first week ("THE GENERAL
/// WARMUP | EXERCISE | SETS | REPS/TIME"). It has the shape of a session, so a read returns it as
/// one, but it is advice for every session rather than a day of the program. A day is left out only
/// when every page it was read from is headed as a warm-up, prints no week, and comes before the
/// first page that holds a training day; everything later is the program's own.
internal static class ImportWarmupRoutine
{
    private static readonly Regex WarmupHeading = new(
        @"^\s*(?:THE\s+)?(?:GENERAL|DYNAMIC|SPECIFIC|PRE[- ]?WORKOUT)?\s*WARM[\s-]?UPS?(?:\s+(?:ROUTINE|PROTOCOL))?\s*:?\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Multiline);
    private static readonly Regex WeekHeading = new(@"\bWEEK\s+\d", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static (List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices) LeaveOut(
        List<DraftWorkout> workouts, IReadOnlyList<ImportPageText> pages)
    {
        var text = pages.ToDictionary(page => page.Page, page => page.Text ?? "");
        bool IsRoutinePage(int page) => text.TryGetValue(page, out var body)
            && WarmupHeading.IsMatch(body) && !WeekHeading.IsMatch(body);
        List<int> PagesOf(DraftWorkout day) => [.. day.Exercises.Select(exercise => exercise.SourcePage)
            .Append(day.SourcePage).OfType<int>().Distinct()];

        var routines = workouts.Where(day => !day.IsRestDay && PagesOf(day) is { Count: > 0 } cited
            && cited.All(IsRoutinePage)).ToList();
        if (routines.Count == 0) return (workouts, []);
        var firstProgramPage = workouts.Except(routines).Where(day => !day.IsRestDay)
            .SelectMany(PagesOf).DefaultIfEmpty(int.MaxValue).Min();
        var leftOut = routines.Where(day => PagesOf(day).Max() < firstProgramPage).ToHashSet();
        if (leftOut.Count == 0) return (workouts, []);
        var first = leftOut.Min(day => PagesOf(day).Min());
        return ([.. workouts.Where(day => !leftOut.Contains(day))],
        [
            new ImportReviewIssue("warmup_routine_left_out",
                $"The warm-up routine printed on page {first}, before the program's first week, is general advice rather than a day of the program, so it was left out.",
                "info", first)
        ]);
    }
}
