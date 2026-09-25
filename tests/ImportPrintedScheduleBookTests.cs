using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The two books that once had handlers of their own, now read by the general printed schedule:
/// Ultimate PPL 4x restarts its weeks in three phases (6 + 4 + 3), and BTS Beginner runs twelve
/// weeks in two blocks whose banners print only on their first page.
public sealed class ImportPrintedScheduleBookTests
{
    private static readonly string[] PplDays = ["legs #1", "push #1", "pull #1", "full body #1"];
    private static readonly string[] BtsDays = ["Upper (Strength Focus)", "Lower (Strength Focus)",
        "Pull (Hypertrophy Focus)", "Push (Hypertrophy Focus)", "Legs (Hypertrophy Focus)"];
    private const string BtsFile = "The_Bodybuilding_Transformation_System_-_Beginner.pdf";

    private static List<ImportPageText> PplPages()
    {
        var pages = new List<ImportPageText> { new(1, "4x/week") };
        var page = 2;
        foreach (var (phase, count) in new[] { (1, 6), (2, 4), (3, 3) })
        {
            pages.Add(new ImportPageText(page++, $"Phase {phase}\nTHE ULTIMATE PUSH PULL LEGS SYSTEM"));
            for (var week = 1; week <= count; week++)
                foreach (var (index, name) in PplDays.Select((name, index) => (index, name)))
                    pages.Add(new ImportPageText(page++, $"DAY LABEL: {name}\nWEEK {week}\n" +
                        "Exercise | Warm-up Sets | WORKING SETS | Reps | Load | RPE | Rest\n" +
                        $"Squat | 1 | 2 | 8-10 | | 8-9 | ~2-3 min{(index is 2 or 3 ? "\nMandatory 1-2 Rest Days" : "")}\n" +
                        "THE ULTIMATE PUSH PULL LEGS SYSTEM | 2"));
        }
        return pages;
    }

    private static List<ImportPageText> BtsPages()
    {
        var pages = new List<ImportPageText> { new(1, ""), new(2, "Important notes"), new(3, "Warm up") };
        var page = 4;
        for (var week = 1; week <= 12; week++)
            foreach (var (index, name) in BtsDays.Select((name, index) => (index, name)))
            {
                var block = week == 1 && index == 0 ? "Foundation Block\n" : week == 6 && index == 0 ? "Ramping Block\n" : "";
                pages.Add(new ImportPageText(page++, $"{block}Tracking Load and Reps\nDAY LABEL: {name}\n" +
                    $"Exercise | Working Sets | Reps | RPE | Rest\nWEEK {week}\n" +
                    $"Squat | 2 | 8-10 | 8 | 2 min{(index is 1 or 4 ? "\nRest Day" : "")}\n" +
                    "The Bodybuilding Transformation System | 1"));
            }
        return pages;
    }

    private static List<DraftWorkout> ReadAsWrong(List<ImportPageText> pages) => pages.Where(page => page.Text.Contains("DAY LABEL:"))
        .Select(page => new DraftWorkout(Guid.NewGuid(), 1, Regex.Match(page.Text, @"DAY LABEL:\s*([^\r\n]+)").Groups[1].Value, null, null,
            [new DraftExercise(Guid.NewGuid(), "Squat", null, null, [new DraftSet(8, 10, 9, 150, null, null, null)])],
            "Block 4", SourcePage: page.Page)).ToList();

    [Fact]
    public void Three_phases_that_restart_at_week_one_become_thirteen_program_weeks()
    {
        var schedule = ImportPrintedSchedule.Read(PplPages())!;
        Assert.Equal(["Phase 1", "Phase 2", "Phase 3"], schedule.Chunks().Select(chunk => chunk.Block).Distinct());
        Assert.Equal(13, schedule.Chunks()[^1].WeekTo);

        var placed = schedule.Reconcile(ReadAsWrong(PplPages()));

        Assert.DoesNotContain(placed.Notices, notice => notice.Severity != "info");
        Assert.Equal(78, placed.Workouts!.Count);
        Assert.All(placed.Workouts.GroupBy(day => day.Week), week =>
            Assert.Equal(["legs #1", "push #1", "pull #1", "Rest Day", "full body #1", "Rest Day"], week.Select(day => day.Name)));
        Assert.Equal((1, "Phase 2"), (placed.Workouts.First(day => day.Week == 7).PhaseWeek, placed.Workouts.First(day => day.Week == 7).Block));
        Assert.Equal(1, placed.Workouts.First(day => day.Week == 11).PhaseWeek);
    }

    [Fact]
    public void Two_blocks_bannered_once_keep_their_blocks_and_weekly_rest_order()
    {
        var schedule = ImportPrintedSchedule.Read(BtsPages())!;
        var placed = schedule.Reconcile(ReadAsWrong(BtsPages())).Workouts!;

        Assert.Equal(84, placed.Count);
        Assert.All(placed.GroupBy(day => day.Week), week => Assert.Equal(
            ["Upper (Strength Focus)", "Lower (Strength Focus)", "Rest Day", "Pull (Hypertrophy Focus)",
                "Push (Hypertrophy Focus)", "Legs (Hypertrophy Focus)", "Rest Day"], week.Select(day => day.Name)));
        Assert.Equal(["Foundation Block", "Ramping Block"], placed.Select(day => day.Block).Distinct());
        Assert.Equal(("Ramping Block", 3), (placed.First(day => day.Week == 8).Block, placed.First(day => day.Week == 8).PhaseWeek));
        Assert.DoesNotContain(ImportValidation.ReviewIssues(new ImportDraft("BTS", placed)),
            issue => issue.Code is "week_day_overflow" or "program_week_gap");
    }

    [Fact]
    public void An_incomplete_schedule_is_not_read()
    {
        var pages = BtsPages();
        pages[^1] = pages[^1] with { Text = pages[^1].Text.Replace("WEEK 12", "") };

        Assert.Null(ImportPrintedSchedule.Read(pages));
    }

    [Fact]
    public async Task A_wrong_outline_still_reads_every_printed_ppl_week()
    {
        var ready = await Import(PplPages(), "ultimate-ppl.pdf", """
            {"programTitle":"The Ultimate Push Pull Legs System","chunks":[
              {"label":"wrong","block":null,"phase":null,"weekFrom":1,"weekTo":1,"pageFrom":3,"pageTo":6,"dayCount":4}]}
            """);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(78, ready.Draft!.Workouts.Count);
        Assert.Equal(13, ready.Draft.Workouts.Select(day => day.Week).Distinct().Count());
        Assert.All(ready.Draft.Workouts.GroupBy(day => day.Week), week => Assert.Equal(6, week.Count()));
        Assert.Contains("Ultimate Push Pull Legs", ready.Draft.ProgramName, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(ready.ReviewIssues!, issue => issue.Severity == "warning");
    }

    [Fact]
    public async Task A_wrong_outline_and_an_extra_rest_finish_with_the_printed_bts_blocks_and_order()
    {
        var ready = await Import(BtsPages(), BtsFile, """
            {"programTitle":"Tracking Load and Reps","chunks":[
              {"label":"Block 1","block":"Block 1","phase":null,"weekFrom":1,"weekTo":1,"pageFrom":4,"pageTo":8,"dayCount":7}]}
            """, extraRestAfter: "Pull");

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal("The Bodybuilding Transformation System", ready.Draft!.ProgramName);
        Assert.Equal(84, ready.Draft.Workouts.Count);
        Assert.Equal(["Foundation Block", "Ramping Block"], ready.Draft.Workouts.Select(day => day.Block).Distinct());
        Assert.Equal(["Upper (Strength Focus)", "Lower (Strength Focus)", "Rest Day", "Pull (Hypertrophy Focus)",
                "Push (Hypertrophy Focus)", "Legs (Hypertrophy Focus)", "Rest Day"],
            ready.Draft.Workouts.Where(day => day.Week == 3).Select(day => day.Name));
        Assert.DoesNotContain(ready.ReviewIssues!, issue => issue.Severity == "warning");
    }

    /// The outline answer is wrong; every section answer names each labelled page's day in week 3
    /// of "Block 4", as a read that trusted the wrong outline would.
    private static async Task<ImportView> Import(List<ImportPageText> pages, string fileName, string outline, string? extraRestAfter = null)
    {
        var calls = 0;
        var handler = new StubHandler(request =>
        {
            var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            string answer;
            if (Interlocked.Increment(ref calls) == 1) answer = outline;
            else
            {
                var requested = Regex.Matches(body, @"=== PAGE (?<page>\d+) ===").Select(match => int.Parse(match.Groups["page"].Value)).ToHashSet();
                var days = new List<AiDay>();
                foreach (var page in pages.Where(page => requested.Contains(page.Page) && page.Text.Contains("DAY LABEL:")))
                {
                    var name = Regex.Match(page.Text, @"DAY LABEL:\s*([^\r\n]+)").Groups[1].Value;
                    days.Add(new AiDay("Block 4", null, 3, 3, name, false, null,
                        [new AiExercise("Squat", null, null, [new AiSet(8, 10, 8, 120, null, null, null, SourcePage: page.Page)], SourcePage: page.Page)], page.Page));
                    if (extraRestAfter is not null && name.StartsWith(extraRestAfter, StringComparison.Ordinal))
                        days.Add(new AiDay("Block 4", null, 3, 3, "Rest Day", true, null, [], page.Page));
                }
                answer = JsonSerializer.Serialize(new AiProgram("wrong section title", days), new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            }
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(answer)}}}]}]}""")
            };
        });
        await using var harness = await Harness.Create(new Dictionary<string, string?> { ["OpenAi:ApiKey"] = "test-key", ["OpenAi:Model"] = "gpt-5.4-mini" });
        await harness.SignIn();
        await harness.Seed(new SeedExercise("squat", "Squat", "Quadriceps", "Barbell", "", null));
        var imports = harness.Imports(handler);
        var pending = await imports.Create(new ImportSourceInput(fileName, pages.Max(page => page.Page), pages), default);
        return await imports.Extract(pending.Id, default);
    }
}
