using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportBeginnerTransformationTests
{
    private const string FileName = "The_Bodybuilding_Transformation_System_-_Beginner.pdf";


    private static List<ImportPageText> Pages()
    {
        var pages = new List<ImportPageText> { new(1, ""), new(2, "Important notes"), new(3, "Warm up") };
        var page = 4;
        for (var week = 1; week <= 12; week++)
        {
            foreach (var (index, name) in new[] { "Upper (Strength Focus)", "Lower (Strength Focus)",
                         "Pull (Hypertrophy Focus)", "Push (Hypertrophy Focus)", "Legs (Hypertrophy Focus)" }
                     .Select((name, index) => (index, name)))
            {
                var block = week == 1 && index == 0 ? "Foundation Block\n"
                    : week == 6 && index == 0 ? "Ramping Block\n" : "";
                var rest = index is 1 or 4 ? "\nRest Day" : "";
                pages.Add(new ImportPageText(page++, $"{block}Tracking Load and Reps\nDAY LABEL: {name}\n" +
                    $"Exercise | Working Sets | Reps | RPE | Rest\nWEEK {week}\n" +
                    $"Squat | 2 | 8-10 | 8 | 2 min{rest}\n" +
                    "The Bodybuilding Transformation System | 1"));
            }
        }
        return pages;
    }

    [Fact]
    public void Printed_schedule_has_two_blocks_and_ends_every_week_with_rest()
    {
        var pages = Pages();
        var schedule = Assert.IsType<ImportBeginnerTransformation>(
            ImportBeginnerTransformation.Read(pages, FileName));
        Assert.Equal(12, schedule.Chunks.Count);
        Assert.Equal(["Foundation Block", "Ramping Block"],
            schedule.Chunks.Select(chunk => chunk.Block).Distinct());
        Assert.Equal(5, schedule.Chunks.Count(chunk => chunk.Block == "Foundation Block"));
        Assert.Equal(7, schedule.Chunks.Count(chunk => chunk.Block == "Ramping Block"));

        var training = pages.Where(page => page.Text.Contains("DAY LABEL:"))
            .Select(page => new DraftWorkout(Guid.NewGuid(), 1, "wrong", null, null,
                [new DraftExercise(Guid.NewGuid(), "Squat", null, null,
                    [new DraftSet(8, 10, 8, 120, null, null, null)])],
                "Block 4", SourcePage: page.Page)).ToList();
        var result = schedule.Reconcile(training);

        Assert.Empty(result.Notices);
        Assert.Equal(84, result.Workouts.Count);
        Assert.All(result.Workouts.GroupBy(day => day.Week), week =>
        {
            Assert.Equal(7, week.Count());
            Assert.Equal(["Upper (Strength Focus)", "Lower (Strength Focus)", "Rest Day",
                "Pull (Hypertrophy Focus)", "Push (Hypertrophy Focus)",
                "Legs (Hypertrophy Focus)", "Rest Day"], week.Select(day => day.Name));
        });
        Assert.Equal("Ramping Block", result.Workouts.First(day => day.Week == 8).Block);
        Assert.Equal("Ramping Block", result.Workouts.First(day => day.Week == 11).Block);
        Assert.DoesNotContain(ImportValidation.ReviewIssues(new ImportDraft(ImportBeginnerTransformation.Title,
            result.Workouts)), issue => issue.Code is "week_day_overflow" or "program_week_gap");
    }

    [Fact]
    public void Incomplete_or_different_edition_does_not_use_beginner_page_reconciliation()
    {
        Assert.Null(ImportBeginnerTransformation.Read(Pages(), "Intermediate_Advanced.pdf"));
        var incomplete = Pages();
        incomplete.RemoveAt(incomplete.Count - 1);
        Assert.Null(ImportBeginnerTransformation.Read(incomplete, FileName));
    }

    [Fact]
    public async Task Wrong_outline_and_extra_week_three_rest_finish_with_source_blocks_and_order()
    {
        var pages = Pages();
        var calls = 0;
        var handler = new StubHandler(request =>
        {
            var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            string answer;
            if (Interlocked.Increment(ref calls) == 1)
            {
                answer = """
                    {"programTitle":"Tracking Load and Reps","chunks":[
                      {"label":"Block 1","block":"Block 1","phase":null,"weekFrom":1,"weekTo":1,
                       "pageFrom":4,"pageTo":8,"dayCount":7}]}
                    """;
            }
            else
            {
                var sourcePages = Regex.Matches(body, @"=== PAGE (?<page>\d+) ===")
                    .Select(match => int.Parse(match.Groups["page"].Value)).Distinct().ToHashSet();
                var days = new List<AiDay>();
                foreach (var page in pages.Where(page => sourcePages.Contains(page.Page) &&
                             page.Text.Contains("DAY LABEL:")))
                {
                    var name = Regex.Match(page.Text, @"DAY LABEL:\s*([^\r\n]+)").Groups[1].Value;
                    days.Add(new AiDay("Block 4", null, 3, 3, name, false, null,
                        [new AiExercise("Squat", null, null,
                            [new AiSet(8, 10, 8, 120, null, null, null, SourcePage: page.Page)],
                            SourcePage: page.Page)], page.Page));
                    if (name.StartsWith("Pull", StringComparison.Ordinal))
                        days.Add(new AiDay("Block 4", null, 3, 3, "Rest Day", true,
                            null, [], page.Page));
                }
                answer = JsonSerializer.Serialize(new AiProgram("Tracking Load and Reps", days),
                    new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            }
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(answer)}}}]}]}""")
            };
        });

        await using var harness = await Harness.Create(new Dictionary<string, string?>
        {
            ["OpenAi:ApiKey"] = "test-key",
            ["OpenAi:Model"] = "gpt-5.4-mini"
        });
        await harness.SignIn();
        await harness.Seed(new SeedExercise("squat", "Squat", "Quadriceps", "Barbell", "", null));
        var imports = harness.Imports(handler);
        var pending = await imports.Create(new ImportSourceInput(FileName, 63, pages), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(12, ready.ChunksTotal);
        Assert.Equal(ImportBeginnerTransformation.Title, ready.Draft!.ProgramName);
        Assert.Equal(84, ready.Draft.Workouts.Count);
        Assert.Equal(["Foundation Block", "Ramping Block"],
            ready.Draft.Workouts.Select(day => day.Block).Distinct());
        Assert.Equal(["Upper (Strength Focus)", "Lower (Strength Focus)", "Rest Day",
            "Pull (Hypertrophy Focus)", "Push (Hypertrophy Focus)",
            "Legs (Hypertrophy Focus)", "Rest Day"],
            ready.Draft.Workouts.Where(day => day.Week == 3).Select(day => day.Name));
        Assert.DoesNotContain(ready.ReviewIssues!, issue => issue.Severity == "warning");
    }
}
