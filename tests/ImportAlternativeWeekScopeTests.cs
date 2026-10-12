using System.Net;
using System.Text.Json;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportAlternativeWeekScopeTests
{
    private static readonly List<ImportPageText> Pages =
    [
        Page(1, "1"), Page(2, "2A"), Page(3, "2B"), Page(4, "3")
    ];

    private static ImportPageText Page(int page, string week) => new(page,
        $"WEEK {week}\nDAY LABEL: Squat\nEXERCISE | WORKING SETS | REPS | RPE | REST | NOTES\nBack Squat | 1 | 3 | 8 | 2 min | Good form");

    private static AiOutline Outline(bool fullPrograms = false) => new("Shared program", [],
    [
        new("a", "Week 2A", [new("Option A", null, null, 2, 2, fullPrograms ? 1 : 2, 2, 1)]),
        new("b", "Week 2B", [new("Option B", null, null, 2, 2, 3, fullPrograms ? 4 : 3, 1)])
    ]);

    [Fact]
    public void Week_options_recover_common_weeks_even_when_the_outline_omits_them()
    {
        var outcome = ImportAlternativeReconciliation.Reconcile(Outline(), Pages);
        Assert.Empty(outcome.Alternatives);
        Assert.Contains(outcome.Chunks, chunk => chunk.PageFrom == 1);
        Assert.Contains(outcome.Chunks, chunk => chunk.PageTo == 4);
        Assert.Contains(outcome.Notices, notice => notice.Code == "alternative_is_week_version");
    }

    [Fact]
    public void Whole_program_options_with_shared_weeks_keep_the_program_choice()
    {
        var outcome = ImportAlternativeReconciliation.Reconcile(Outline(fullPrograms: true), Pages);
        Assert.Equal(2, outcome.Alternatives.Count);
        Assert.DoesNotContain(outcome.Notices, notice => notice.Code == "alternative_is_week_version");
    }

    [Theory]
    [InlineData("week-a", 2, 3)]
    [InlineData("week-b", 3, 2)]
    public async Task A_model_week_choice_reads_the_whole_program_and_keeps_only_the_selected_week(
        string choice, int keptPage, int droppedPage)
    {
        await using var harness = await Harness.Create(new Dictionary<string, string?>
        {
            ["OpenAi:ApiKey"] = "test-key", ["OpenAi:Model"] = "gpt-5.4-mini"
        });
        await harness.SignIn();
        var calls = 0;
        var stub = new StubHandler(_ =>
        {
            calls++;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(JsonSerializer.Serialize(new
                {
                    status = "completed",
                    output = new[] { new { content = new[] { new { type = "output_text", text = JsonSerializer.Serialize(Outline()) } } } }
                }))
            };
        });
        // Force the outline read so the regression exercises a model's misclassification.
        var pages = Pages.Prepend(new ImportPageText(5, "Choose a program option.")).ToList();
        var imports = harness.Imports(stub);
        var pending = await imports.Create(new ImportSourceInput("week-options.pdf", 5, pages), default);
        Assert.Equal("extract", pending.Stage);
        var read = await imports.Extract(pending.Id, default);
        Assert.Equal("select", read.Stage);
        Assert.All(read.Alternatives!, alternative => Assert.Equal(ImportAlternativeKinds.Week, alternative.Kind));
        var selected = await imports.SelectAlternative(read.Id, choice, default);
        Assert.Equal("done", selected.Stage);
        Assert.Equal("Shared program", selected.Draft!.ProgramName);
        Assert.Equal([1, 2, 3], selected.Draft.Workouts.Select(day => day.Week).Distinct());
        Assert.Contains(selected.Draft.Workouts, day => day.SourcePage == 1);
        Assert.Contains(selected.Draft.Workouts, day => day.SourcePage == 4 && day.Week == 3);
        Assert.Contains(selected.Draft.Workouts, day => day.SourcePage == keptPage && day.Week == 2);
        Assert.DoesNotContain(selected.Draft.Workouts, day => day.SourcePage == droppedPage);
        Assert.Equal(1, calls);
    }
}
