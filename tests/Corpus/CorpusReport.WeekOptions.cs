using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests.Corpus;

public sealed partial class CorpusReport
{
    [Theory]
    [InlineData("week-a", 64, 66)]
    [InlineData("week-b", 66, 64)]
    public async Task Powerbuilding_week_options_misread_as_programs_preserve_all_eleven_weeks(
        string choice, int keptPage, int droppedPage)
    {
        var folder = Environment.GetEnvironmentVariable("WORKOUT_PDF_CORPUS");
        if (string.IsNullOrWhiteSpace(folder)) return;
        var file = Path.Combine(folder, "Powerbuilding-System_4xweek.json");
        Assert.True(File.Exists(file), "The real Powerbuilding source fixture is required.");
        var outline = new AiOutline("Powerbuilding System", [],
        [
            new("option-a", "Week 10A max testing option A",
                [new("Week 10A", null, null, 10, 10, 63, 64, 3)]),
            new("option-b", "Week 10B max testing option B",
                [new("Week 10B", null, null, 10, 10, 65, 66, 3)])
        ]);
        var catalog = Json.Read<List<SeedExercise>>(File.ReadAllText(CatalogPath()));
        var result = await Replay(file, catalog, drifting: false, selectedAlternativeId: null,
            weekChoiceId: choice, outlineOverride: outline);
        Assert.True(result.View.Status == "ready", $"{result.View.Status}: {result.View.Error}; {string.Join("; ", result.View.ReviewIssues!.Select(issue => issue.Message))}");
        Assert.Contains(ImportAlternativeReconciliation.Reconcile(outline, result.Pages).Notices,
            issue => issue.Code == ImportAlternativeWeekScope.NoticeCode);
        Assert.Equal(2, result.WeekChoices.Count);
        var draft = result.View.Draft!;
        Assert.Equal(Enumerable.Range(1, 11), draft.Workouts.Select(day => day.Week).Distinct());
        Assert.Contains(draft.Workouts, day => day.Week == 11 && day.SourcePage == 68);
        Assert.Contains(draft.Workouts, day => day.Week == 11 && day.SourcePage == 69);
        Assert.Equal([1, 3, 5, 7, 9], draft.Workouts.Where(day => day.SourcePage == 71 && !day.IsRestDay).Select(day => day.Week));
        Assert.DoesNotContain(draft.Workouts, day => day.SourcePage == 80);
        Assert.Equal(3, draft.Workouts.Count(day => day.Week == 10 && !day.IsRestDay));
        Assert.Contains(draft.Workouts, day => day.SourcePage == keptPage && day.Week == 10);
        Assert.DoesNotContain(draft.Workouts, day => day.SourcePage == droppedPage);
        if (choice == "week-a")
        {
            var squat = draft.Workouts.First(day => day.SourcePage == 64 && !day.IsRestDay).Exercises[0];
            Assert.Equal("AS MANY REPS AS POSSIBLE. ALWAYS USE A SPOTTER AND GOOD FORM. AIM TO 3+ REPS", squat.Notes);
            Assert.Null(squat.Sets.Last().RepMin);
        }
        var baseline = await Replay(file, catalog, drifting: false, selectedAlternativeId: null, weekChoiceId: choice);
        var failures = new List<string>();
        CompareSemantics(baseline.View.Draft, baseline.CanonicalNames,
            draft with { ProgramName = baseline.View.Draft!.ProgramName }, result.CanonicalNames,
            $"Recovered {choice}", failures);
        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }
}
