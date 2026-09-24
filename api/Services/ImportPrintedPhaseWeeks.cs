using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// <summary>
/// The 4x Ultimate PPL book prints one training table per page, four per local week.
/// Its three phases restart at week one, so page evidence is more reliable than a model's
/// overlapping outline. This reader activates only when the complete printed pattern agrees.
/// </summary>
internal sealed class ImportPrintedPhaseWeeks
{
    private static readonly Regex PhaseHeading = new(@"(?m)^Phase\s+(?<number>[123])\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex WeekHeading = new(@"(?m)^WEEK\s+(?<number>\d+)\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex DayHeading = new(@"(?m)^DAY LABEL:\s*(?<name>[^\r\n]+)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex RestBand = new(@"(?m)^Mandatory\s+1\s*[-–]\s*2\s+Rest\s+Days\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private sealed record SourceDay(int Page, int Week, int PhaseWeek, int PhaseNumber,
        string Name, bool RestFollows);

    private readonly List<SourceDay> sourceDays;
    private ImportPrintedPhaseWeeks(List<SourceDay> sourceDays)
    {
        this.sourceDays = sourceDays;
        Chunks = sourceDays.GroupBy(day => day.Week).Select(week =>
        {
            var first = week.First();
            return new ImportChunk($"Phase {first.PhaseNumber}, week {first.PhaseWeek}",
                $"Phase {first.PhaseNumber}", $"Phase {first.PhaseNumber}",
                week.Key, week.Key, first.Page, week.Last().Page, 6);
        }).ToList();
    }

    public const string Title = "The Ultimate Push Pull Legs System - 4x/week";
    public List<ImportChunk> Chunks { get; }

    public static ImportPrintedPhaseWeeks? Read(IReadOnlyList<ImportPageText> pages)
    {
        if (!pages.Any(page => page.Page == 1 && page.Text.Trim().Equals("4x/week", StringComparison.OrdinalIgnoreCase)) ||
            pages.Count(page => page.Text.Contains("THE ULTIMATE PUSH PULL LEGS SYSTEM", StringComparison.OrdinalIgnoreCase)) < 40)
            return null;

        var ordered = pages.OrderBy(page => page.Page).ToList();
        var covers = ordered.Select(page => (page.Page, Match: PhaseHeading.Match(page.Text)))
            .Where(item => item.Match.Success)
            .Select(item => (item.Page, Number: int.Parse(item.Match.Groups["number"].Value))).ToList();
        if (covers.Count != 3 || !covers.Select(cover => cover.Number).SequenceEqual([1, 2, 3])) return null;

        var sourceDays = new List<SourceDay>();
        var absoluteWeek = 0;
        for (var phaseIndex = 0; phaseIndex < covers.Count; phaseIndex++)
        {
            var from = covers[phaseIndex].Page + 1;
            var to = phaseIndex + 1 < covers.Count ? covers[phaseIndex + 1].Page - 1 : ordered.Max(page => page.Page);
            var phasePages = ordered.Where(page => page.Page >= from && page.Page <= to &&
                DayHeading.IsMatch(page.Text)).ToList();
            var weeks = phasePages.GroupBy(page =>
            {
                var match = WeekHeading.Match(page.Text);
                return match.Success ? int.Parse(match.Groups["number"].Value) : 0;
            }).ToList();
            if (weeks.Count == 0 || weeks.Any(week => week.Key == 0 || week.Count() != 4) ||
                !weeks.Select(week => week.Key).SequenceEqual(Enumerable.Range(1, weeks.Count))) return null;

            foreach (var week in weeks)
            {
                absoluteWeek++;
                var dayIndex = 0;
                foreach (var page in week)
                {
                    var title = DayHeading.Match(page.Text).Groups["name"].Value.Trim();
                    if (DayHeading.Matches(page.Text).Count != 1 ||
                        !ExpectedDay(title, dayIndex) ||
                        RestBand.IsMatch(page.Text) != (dayIndex is 2 or 3)) return null;
                    sourceDays.Add(new SourceDay(page.Page, absoluteWeek, week.Key,
                        covers[phaseIndex].Number, title, dayIndex is 2 or 3));
                    dayIndex++;
                }
            }
        }

        // This particular edition's printed sequence is 6 + 4 + 3 weeks. An incomplete text
        // layer or a different edition must remain with the normal, reviewable importer path.
        return sourceDays.Count == 52 && absoluteWeek == 13 &&
            sourceDays.GroupBy(day => day.PhaseNumber).Select(group => group.Select(day => day.Week).Distinct().Count())
                .SequenceEqual([6, 4, 3])
            ? new ImportPrintedPhaseWeeks(sourceDays) : null;
    }

    private static bool ExpectedDay(string title, int index)
        => index switch
        {
            0 => title.StartsWith("legs", StringComparison.OrdinalIgnoreCase),
            1 => title.StartsWith("push", StringComparison.OrdinalIgnoreCase),
            2 => title.StartsWith("pull", StringComparison.OrdinalIgnoreCase),
            _ => title.StartsWith("full body", StringComparison.OrdinalIgnoreCase)
        };

    public (List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices) Reconcile(
        IReadOnlyList<DraftWorkout> workouts)
    {
        var byPage = workouts.Select(day => (Day: day, Page: SourcePage(day)))
            .Where(item => item.Page.HasValue).GroupBy(item => item.Page!.Value)
            .ToDictionary(group => group.Key, group => group.Select(item => item.Day).ToList());
        var result = new List<DraftWorkout>();
        var notices = new List<ImportReviewIssue>();
        foreach (var source in sourceDays)
        {
            var candidates = byPage.GetValueOrDefault(source.Page) ?? [];
            var training = candidates.Where(day => !day.IsRestDay).ToList();
            if (training.Count != 1)
            {
                notices.Add(new ImportReviewIssue("printed_training_page_count",
                    $"PDF page {source.Page} prints one {source.Name} table but the read found {training.Count}. Check that page in review.",
                    "warning", source.Page, TargetField: "exercises"));
            }
            if (training.Count == 0) continue;

            var selected = training.OrderByDescending(day => day.Exercises.Count).First();
            result.Add(Place(selected, source, false));
            if (!source.RestFollows) continue;
            var rest = candidates.FirstOrDefault(day => day.IsRestDay);
            result.Add(Place(rest ?? new DraftWorkout(Guid.NewGuid(), source.Week, "Rest Day", null,
                null, [], IsRestDay: true, SourcePage: source.Page), source, true));
        }
        return (result, notices);
    }

    private static DraftWorkout Place(DraftWorkout day, SourceDay source, bool rest)
        => day with
        {
            Week = source.Week,
            PhaseWeek = source.PhaseWeek,
            Block = $"Phase {source.PhaseNumber}",
            Phase = $"Phase {source.PhaseNumber}",
            Name = rest ? "Rest Day" : source.Name,
            IsRestDay = rest,
            SourcePage = source.Page,
            Exercises = rest ? [] : day.Exercises,
            BlockId = null,
            WeekId = null
        };

    private static int? SourcePage(DraftWorkout day)
    {
        if (day.SourcePage.HasValue) return day.SourcePage;
        var pages = day.Exercises.Select(exercise => exercise.SourcePage).Where(page => page.HasValue)
            .Distinct().Take(2).ToList();
        return pages.Count == 1 ? pages[0] : null;
    }
}
