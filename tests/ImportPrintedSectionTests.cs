using System.Net;
using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A section whose pages are clean printed tables on a complete schedule is read from those tables
/// with no model call; anything the tables do not settle still goes to the model.
public sealed class ImportPrintedSectionTests
{
    private static ImportPageText Page(int number, int week, string label, string rows, bool rest = false)
        => new(number, $"WEEK {week}\nDAY LABEL: {label}\n" +
            "Exercise | Last-Set Intensity Technique | Warm-up Sets | WORKING SETS | Reps | Early Set RPE | Last Set RPE | Rest\n" +
            rows + (rest ? "\n1-2 Rest Days" : "") + "\nThe Pure Bodybuilding Program | 3");

    private const string Upper = "Superset A1: Lat Pulldown | Long-length Partials | 1 | 3 | 8-10 | ~7-8 | ~9 | ~2 min\nSuperset A2: Machine Chest Press | N/A | 1 | 3 | 8-10 | ~8 | ~9 | ~2 min";
    private const string Lower = "Hack Squat | N/A | 2 | 2 | 6-8 | ~8 | ~9 | ~3 min\nLeg Curl | Myo-reps | 1 | 2 | 10-12 | ~8 | ~10 | ~1 min";

    private static List<ImportPageText> Book() =>
        [new(1, "IMPORTANT PROGRAM NOTES"), Page(4, 1, "Upper", Upper), Page(5, 1, "Lower", Lower, rest: true),
            Page(6, 2, "Upper", Upper), Page(7, 2, "Lower", Lower, rest: true)];

    private static string Text(IEnumerable<ImportPageText> pages) => ImportSourceText.Slice(pages.ToList(), 1, 100);

    [Fact]
    public void A_clean_scheduled_section_is_read_from_its_tables()
    {
        var pages = Book();
        var program = ImportTableEvidence.ReadPrintedSection(ImportPrintedSchedule.Read(pages)!.Days, Text(pages))!;

        Assert.Equal(["Upper", "Lower", "Rest Day", "Upper", "Lower", "Rest Day"], program.Days!.Select(day => day.DayName));
        Assert.Equal([1, 1, 1, 2, 2, 2], program.Days.Select(day => day.WeekNumber));
        var pulldown = program.Days[0].Exercises[0];
        Assert.Equal(("Lat Pulldown", "A1", 3), (pulldown.SourceName, pulldown.SequenceGroup, pulldown.Sets.Count));
        Assert.Equal([8d, 8d, 9d], pulldown.Sets.Select(set => set.TargetRpe));
        Assert.Equal("Long-length Partials", pulldown.Sets[^1].Notes);
        Assert.Null(pulldown.Sets[0].Notes);
        Assert.Null(program.Days[1].Exercises[0].Sets[^1].Notes);
    }

    [Fact]
    public void A_table_no_label_names_sends_the_section_to_the_model()
    {
        var pages = Book();
        pages[1] = pages[1] with { Text = pages[1].Text + "\nExercise | WORKING SETS | Reps\nCable Crunch | 3 | 12-15" };

        Assert.Null(ImportTableEvidence.ReadPrintedSection(ImportPrintedSchedule.Read(pages)!.Days, Text(pages)));
    }

    [Fact]
    public void A_row_whose_set_count_is_unreadable_sends_the_section_to_the_model()
    {
        var pages = Book();
        pages[2] = pages[2] with { Text = pages[2].Text.Replace("Hack Squat | N/A | 2 | 2 |", "Hack Squat | N/A | 2 | 2 or 3 |") };

        Assert.Null(ImportTableEvidence.ReadPrintedSection(ImportPrintedSchedule.Read(pages)!.Days, Text(pages)));
    }

    [Fact]
    public async Task A_book_printed_entirely_as_clean_tables_imports_with_only_the_outline_read()
    {
        var pages = Book();
        var calls = 0;
        var handler = new StubHandler(_ =>
        {
            // Only the outline should be asked for; a section answer would be empty and wrong.
            var answer = Interlocked.Increment(ref calls) == 1
                ? """{"programTitle":"The Pure Bodybuilding Program","chunks":[{"label":"All","block":null,"phase":null,"weekFrom":1,"weekTo":2,"pageFrom":4,"pageTo":7,"dayCount":6}]}"""
                : """{"programTitle":null,"days":[]}""";
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(answer)}}}]}]}""")
            };
        });
        await using var harness = await Harness.Create(new Dictionary<string, string?> { ["OpenAi:ApiKey"] = "test-key", ["OpenAi:Model"] = "gpt-5.4-mini" });
        await harness.SignIn();
        await harness.Seed(new SeedExercise("hack-squat", "Hack Squat", "Quadriceps", "Machine", "", null));
        var imports = harness.Imports(handler);

        var pending = await imports.Create(new ImportSourceInput("pure.pdf", 7, pages), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(1, calls);
        Assert.Equal(6, ready.Draft!.Workouts.Count);
        Assert.Equal(4, ready.Draft.Workouts.Count(day => !day.IsRestDay && day.Exercises.Count == 2));
        Assert.Contains(ready.ReviewIssues!, issue => issue.Code == "printed_sections_read");
        Assert.DoesNotContain(ready.ReviewIssues!, issue => issue.Severity == "warning");
    }
}
