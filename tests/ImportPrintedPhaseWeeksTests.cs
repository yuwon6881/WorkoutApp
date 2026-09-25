using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Workout.Api.Services;
using Workout.Api.Data;
using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

public sealed class ImportPrintedPhaseWeeksTests
{
    private static List<ImportPageText> Pages()
    {
        var pages = new List<ImportPageText> { new(1, "4x/week") };
        var page = 2;
        foreach (var (phase, count) in new[] { (1, 6), (2, 4), (3, 3) })
        {
            pages.Add(new ImportPageText(page++, $"Phase {phase}\nTHE ULTIMATE PUSH PULL LEGS SYSTEM"));
            for (var week = 1; week <= count; week++)
            {
                foreach (var (index, name) in new[] { "legs #1", "push #1", "pull #1", "full body #1" }
                    .Select((name, index) => (index, name)))
                {
                    var rest = index is 2 or 3 ? "\nMandatory 1-2 Rest Days" : "";
                    pages.Add(new ImportPageText(page++, $"DAY LABEL: {name}\nWEEK {week}\n" +
                        "Exercise | Warm-up Sets | WORKING SETS | Reps | Load | RPE | Rest\n" +
                        $"Squat | 1 | 2 | 8-10 | | 8-9 | ~2-3 min{rest}\n" +
                        "THE ULTIMATE PUSH PULL LEGS SYSTEM | 2"));
                }
            }
        }
        return pages;
    }

    [Fact]
    public void Three_printed_local_week_cycles_become_thirteen_source_ordered_program_weeks()
    {
        var pages = Pages();
        var schedule = Assert.IsType<ImportPrintedPhaseWeeks>(ImportPrintedPhaseWeeks.Read(pages));
        Assert.Equal(13, schedule.Chunks.Count);
        Assert.Equal(["Phase 1", "Phase 2", "Phase 3"],
            schedule.Chunks.Select(chunk => chunk.Block).Distinct());
        Assert.Equal(Enumerable.Range(1, 13), schedule.Chunks.Select(chunk => chunk.WeekFrom));

        var training = pages.Where(page => page.Text.Contains("DAY LABEL:"))
            .Select(page => new DraftWorkout(Guid.NewGuid(), 1, "wrong", null, null,
                [new DraftExercise(Guid.NewGuid(), "Squat", null, null, [new DraftSet(8, 10, 9, 150, null, null, null)])],
                SourcePage: page.Page)).ToList();
        var result = schedule.Reconcile(training);

        Assert.Empty(result.Notices);
        Assert.Equal(78, result.Workouts.Count);
        Assert.All(result.Workouts.GroupBy(day => day.Week), week =>
        {
            Assert.Equal(6, week.Count());
            Assert.Equal(2, week.Count(day => day.IsRestDay));
            Assert.Equal(["legs #1", "push #1", "pull #1", "Rest Day", "full body #1", "Rest Day"],
                week.Select(day => day.Name));
        });
        Assert.Equal(1, result.Workouts.First(day => day.Week == 7).PhaseWeek);
        Assert.Equal(1, result.Workouts.First(day => day.Week == 11).PhaseWeek);
        Assert.DoesNotContain(ImportValidation.ReviewIssues(new ImportDraft(ImportPrintedPhaseWeeks.Title, result.Workouts)),
            issue => issue.Code is "week_day_overflow" or "program_week_gap");
    }

    [Fact]
    public void An_incomplete_or_other_book_keeps_the_normal_import_path()
    {
        var incomplete = Pages();
        incomplete.RemoveAt(incomplete.Count - 1);
        Assert.Null(ImportPrintedPhaseWeeks.Read(incomplete));
        Assert.Null(ImportPrintedPhaseWeeks.Read([new ImportPageText(1, "4x/week"),
            new ImportPageText(2, "WEEK 1\nDAY LABEL: Pull") ]));
    }

    [Fact]
    public void Printed_table_rows_restore_omitted_movements_and_targets()
    {
        var program = new AiProgram("wrong", [new AiDay(null, null, 1, 1, "Pull #1", false, null,
            [new AiExercise("Lat Pulldown (Failure Set)", null, null,
                [new AiSet(1, 1, null, null, null, null, null, RpeSource: "inferred")], SourcePage: 37)], 37)]);
        const string source = """
            === PAGE 37 ===
            DAY LABEL: pull #1
            Exercise | Warm-up Sets | WORKING SETS | Reps | Load | RPE | Rest | NOTES
            Lat Pulldown (Feeder Sets) | 0 | 4 | 10 | | See Notes | ~2-3 min | Four feeder sets
            Lat Pulldown (Failure Set) | 0 | 1 | 10+5 | | 10 | ~2-3 min | Dropset
            Omni-Grip Machine Chest-Supported Row | 2 | 3 | 10-12 | | 8-9 | ~2-3 min | Three grips
            Mandatory 1-2 Rest Days
            """;

        var enriched = ImportTableEvidence.Enrich(program, source);
        var day = enriched.Days![0];
        Assert.Equal(3, day.Exercises.Count);
        Assert.Equal([4, 1, 3], day.Exercises.Select(exercise => exercise.Sets.Count));
        Assert.Equal(["0", "0", "2"], day.Exercises.Select(exercise => exercise.WarmupSets));
        Assert.All(day.Exercises[0].Sets, set => Assert.Null(set.TargetRpe));
        Assert.All(day.Exercises[0].Sets, set => Assert.Equal("extracted", set.RpeSource));
        Assert.Equal(10, day.Exercises[1].Sets[0].TargetRpe);
        Assert.All(day.Exercises[2].Sets, set => Assert.Equal(9, set.TargetRpe));
        Assert.All(day.Exercises.SelectMany(exercise => exercise.Sets), set => Assert.Equal(150, set.RestSeconds));
        Assert.Equal(2, enriched.Days.Count);
    }

    [Fact]
    public void An_already_read_footer_rest_is_not_turned_into_a_second_training_table()
    {
        var program = new AiProgram("sample", [
            new AiDay(null, null, 1, 1, "Pull #1", false, null,
                [new AiExercise("Squat", null, null, [new AiSet(8, 10, 9, 150, null, null, null)],
                    SourcePage: 37)], 37),
            new AiDay(null, null, 1, 1, "Rest Day", true, null, [], 37)
        ]);
        const string source = """
            === PAGE 37 ===
            DAY LABEL: pull #1
            Exercise | Warm-up Sets | WORKING SETS | Reps | Load | RPE | Rest
            Squat | 1 | 2 | 8-10 | | 8-9 | ~2-3 min
            Mandatory 1-2 Rest Days
            """;

        var enriched = ImportTableEvidence.Enrich(program, source);
        Assert.Equal(2, enriched.Days!.Count);
        Assert.Single(enriched.Days, day => !day.IsRestDay);
        Assert.Single(enriched.Days, day => day.IsRestDay);
    }

    [Fact]
    public async Task Wrong_outline_and_local_week_numbers_still_finish_as_three_complete_phases()
    {
        var pages = Pages();
        var calls = 0;
        var handler = new StubHandler(request =>
        {
            var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            var number = Interlocked.Increment(ref calls);
            string answer;
            if (number == 1)
            {
                answer = """
                    {"programTitle":"The Ultimate Push Pull Legs System 3","chunks":[
                      {"label":"wrong","block":null,"phase":null,"weekFrom":1,"weekTo":1,
                       "pageFrom":3,"pageTo":6,"dayCount":4}]}
                    """;
            }
            else
            {
                var sourcePages = Regex.Matches(body, @"=== PAGE (?<page>\d+) ===")
                    .Select(match => int.Parse(match.Groups["page"].Value)).Distinct().ToHashSet();
                var days = pages.Where(page => sourcePages.Contains(page.Page) &&
                    page.Text.Contains("DAY LABEL:")).Select(page =>
                {
                    var name = Regex.Match(page.Text, @"DAY LABEL:\s*([^\r\n]+)").Groups[1].Value;
                    return new AiDay(null, null, 1, 1, name, false, null,
                        [new AiExercise("Squat", null, null,
                            [new AiSet(1, 1, null, null, null, null, null,
                                RpeSource: "inferred", RestSource: "inferred", SourcePage: page.Page)],
                            SourcePage: page.Page)], page.Page);
                }).ToList();
                answer = JsonSerializer.Serialize(new AiProgram("wrong section title", days),
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
        var pending = await imports.Create(new ImportSourceInput("ultimate-ppl.pdf", pages.Max(page => page.Page), pages), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(13, ready.ChunksTotal);
        Assert.Equal(ImportPrintedPhaseWeeks.Title, ready.Draft!.ProgramName);
        Assert.Equal(78, ready.Draft.Workouts.Count);
        Assert.Equal(13, ready.Draft.Workouts.Select(day => day.Week).Distinct().Count());
        Assert.All(ready.Draft.Workouts.GroupBy(day => day.Week), week =>
            Assert.Equal(6, week.Count()));
        Assert.DoesNotContain(ready.ReviewIssues!, issue => issue.Severity == "warning");
    }
}
