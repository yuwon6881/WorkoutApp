using System.Net;
using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The model's outline stops at week 10A, while the printed schedule contains both week-10
/// options and the following deload. The source schedule must complete the read before either
/// selected branch is allowed to become ready.
public sealed class ImportWeekChoiceIntegrationTests
{
    private const string Outline = """
        {"programTitle":"Powerbuilding System","chunks":[{"label":"Weeks 1-10","block":null,"phase":null,"weekFrom":1,"weekTo":10,"pageFrom":1,"pageTo":10,"dayCount":10}]}
        """;

    private static string TablePage(int page, string weekHeading, string dayName, string? extra = null)
        => $"THE POWERBUILDING SYSTEM\n{weekHeading}\nDAY LABEL: {dayName}\n" +
            "Exercise | Last-Set Intensity Technique | Warm-up Sets | WORKING SETS | Reps | Early Set RPE | Last Set RPE | Rest\n" +
            "Lat Pulldown | Long-length Partials | 1 | 3 | 8-10 | ~7-8 | ~9 | ~2 min\n" +
            (extra is null ? "" : $"{extra}\n") + $"THE POWERBUILDING SYSTEM | {page}";

    private static List<ImportPageText> SourcePages()
    {
        var pages = Enumerable.Range(1, 9)
            .Select(week => new ImportPageText(week, TablePage(week, $"WEEK {week}", $"Training Day {week}",
                week == 1 ? "Choose the program printed in this PDF." : null)))
            .ToList();
        pages.Add(new ImportPageText(10, TablePage(10, "WEEK 10A", "Squat Test")));
        pages.Add(new ImportPageText(11, "WEEK 10: OPTION B\nPOWERBUILDING\nSYSTEM\n[MAX TESTING]"));
        pages.Add(new ImportPageText(12, TablePage(12, "WEEK 10B", "Squat Test")));
        pages.Add(new ImportPageText(13, "WEEK 11\nPOWERBUILDING\nSYSTEM\n[DELOAD]"));
        pages.Add(new ImportPageText(14, TablePage(14, "WEEK 11", "Deload Lower #1")));
        pages.Add(new ImportPageText(15, TablePage(15, "WEEK 11", "Deload Upper #1")));
        return pages;
    }

    private static HttpResponseMessage Answer(string payload) => new(HttpStatusCode.OK)
    {
        Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(payload)}}}]}]}""")
    };

    [Theory]
    [InlineData("week-a", 10)]
    [InlineData("week-b", 12)]
    public async Task An_incomplete_outline_does_not_drop_the_deload_and_each_choice_is_reverified(string choiceId, int optionPage)
    {
        await using var harness = await Harness.Create(new Dictionary<string, string?>
        {
            ["OpenAi:ApiKey"] = "test-key",
            ["OpenAi:Model"] = "gpt-5.4-mini"
        });
        await harness.SignIn();
        await harness.Seed(new SeedExercise("lat-pulldown", "Lat Pulldown", "Back", "Machine", null));
        var unexpectedSectionReads = 0;
        var handler = new StubHandler(request =>
        {
            var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            if (body.Contains("training_program_outline", StringComparison.Ordinal)) return Answer(Outline);
            Interlocked.Increment(ref unexpectedSectionReads);
            return Answer("""{"programTitle":null,"days":[]}""");
        });
        var imports = harness.Imports(handler);

        var outlined = await imports.Create(new ImportSourceInput("powerbuilding-system.pdf", 15, SourcePages()), default);
        Assert.Equal("extract", outlined.Stage);
        var extracted = await imports.Extract(outlined.Id, default);

        Assert.Equal("select", extracted.Stage);
        var alternatives = extracted.Alternatives!;
        Assert.Equal(["week-a", "week-b"], alternatives.Select(alternative => alternative.Id));
        Assert.Equal(1, handler.Calls);
        Assert.Equal(0, unexpectedSectionReads);

        var ready = await imports.SelectAlternative(extracted.Id, choiceId, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        var draft = ready.Draft!;
        Assert.Equal(Enumerable.Range(1, 11), draft.Workouts.Select(day => day.Week).Distinct().Order());
        Assert.DoesNotContain(draft.Workouts, day => day.Week == 12);
        Assert.All(draft.Workouts.Where(day => day.SourcePage is 14 or 15), day => Assert.Equal(11, day.Week));
        Assert.All(draft.Workouts.Where(day => day.Week == 11), day => Assert.Equal(("Deload Week", 1), (day.Phase, day.PhaseWeek)));
        var optionDay = Assert.Single(draft.Workouts, day => day.SourcePage == optionPage);
        Assert.Equal(10, optionDay.Week);
        var exercise = Assert.Single(optionDay.Exercises);
        Assert.Equal("Lat Pulldown", exercise.SourceName);
        var workingSets = exercise.Sets.Where(set => !set.Warmup).ToList();
        Assert.Equal(3, workingSets.Count);
        Assert.All(workingSets, set => Assert.Equal("8-10", set.RepsText));
        Assert.Equal([8d, 8d, 9d], workingSets.Select(set => set.TargetRpe));
        Assert.All(exercise.Sets, set => Assert.Equal(120, set.RestSeconds));
        Assert.Contains(ready.ReviewIssues!, issue => issue.Code == ImportWeekChoice.ChosenCode);
    }
}
