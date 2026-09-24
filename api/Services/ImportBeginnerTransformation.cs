using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// <summary>
/// The Beginner Transformation schedule is twelve consecutive five-table weeks. Only its first
/// and sixth weeks print block banners; each week's Lower and Legs pages print a rest slot.
/// Reading those page-local claims prevents a repeated table heading from becoming a new block.
/// </summary>
internal sealed class ImportBeginnerTransformation
{
    private static readonly Regex WeekHeading = new(@"(?m)^WEEK\s+(?<number>\d+)\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex DayHeading = new(@"(?m)^DAY LABEL:\s*(?<name>[^\r\n]+)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex RestDay = new(@"(?m)^Rest Day\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private sealed record SourceDay(int Page, int Week, string Name, string Block, bool RestFollows);

    private readonly List<SourceDay> sourceDays;
    private ImportBeginnerTransformation(List<SourceDay> sourceDays)
    {
        this.sourceDays = sourceDays;
        Chunks = sourceDays.GroupBy(day => day.Week).Select(week =>
        {
            var first = week.First();
            return new ImportChunk($"{first.Block}, week {week.Key}", first.Block,
                null, week.Key, week.Key, first.Page, week.Last().Page, 7);
        }).ToList();
    }

    public const string Title = "The Bodybuilding Transformation System - Beginner";
    public List<ImportChunk> Chunks { get; }

    public static ImportBeginnerTransformation? Read(IReadOnlyList<ImportPageText> pages, string fileName)
    {
        // The companion Intermediate/Advanced edition has a similar cover and footer. The
        // filename is the only machine-readable edition label in this PDF's text layer.
        if (!fileName.Contains("Beginner", StringComparison.OrdinalIgnoreCase)) return null;
        var ordered = pages.OrderBy(page => page.Page).ToList();
        if (ordered.Count(page => page.Text.Contains("The Bodybuilding Transformation System |",
                StringComparison.OrdinalIgnoreCase)) < 50 ||
            ordered.Count(page => page.Text.Contains("Tracking Load and Reps",
                StringComparison.OrdinalIgnoreCase)) < 50)
            return null;

        var tables = ordered.Where(page => DayHeading.IsMatch(page.Text)).ToList();
        if (tables.Count != 60 || tables.Any(page => DayHeading.Matches(page.Text).Count != 1)) return null;
        var weeks = tables.GroupBy(page =>
        {
            var match = WeekHeading.Match(page.Text);
            return match.Success ? int.Parse(match.Groups["number"].Value) : 0;
        }).ToList();
        if (weeks.Count != 12 || weeks.Any(week => week.Count() != 5) ||
            !weeks.Select(week => week.Key).SequenceEqual(Enumerable.Range(1, 12))) return null;

        var banners = tables.Select(page => (page.Page,
            Foundation: page.Text.Split('\n').Any(line => line.Trim().Equals("Foundation Block", StringComparison.OrdinalIgnoreCase)),
            Ramping: page.Text.Split('\n').Any(line => line.Trim().Equals("Ramping Block", StringComparison.OrdinalIgnoreCase))))
            .Where(item => item.Foundation || item.Ramping).ToList();
        if (banners.Count != 2 || !banners[0].Foundation || banners[0].Ramping ||
            banners[0].Page != weeks[0].First().Page || !banners[1].Ramping ||
            banners[1].Foundation || banners[1].Page != weeks[5].First().Page)
            return null;

        var sourceDays = new List<SourceDay>(60);
        foreach (var week in weeks)
        {
            var index = 0;
            foreach (var page in week)
            {
                var restFollows = RestDay.IsMatch(page.Text);
                if (restFollows != (index is 1 or 4)) return null;
                sourceDays.Add(new SourceDay(page.Page, week.Key,
                    DayHeading.Match(page.Text).Groups["name"].Value.Trim(),
                    week.Key <= 5 ? "Foundation Block" : "Ramping Block", restFollows));
                index++;
            }
        }
        return new ImportBeginnerTransformation(sourceDays);
    }

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
                notices.Add(new ImportReviewIssue("printed_training_page_count",
                    $"PDF page {source.Page} prints one {source.Name} table but the read found {training.Count}. Check that page in review.",
                    "warning", source.Page, TargetField: "exercises"));
            if (training.Count == 0) continue;

            result.Add(Place(training.OrderByDescending(day => day.Exercises.Count).First(), source, false));
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
            PhaseWeek = source.Week <= 5 ? source.Week : source.Week - 5,
            Block = source.Block,
            Phase = null,
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
