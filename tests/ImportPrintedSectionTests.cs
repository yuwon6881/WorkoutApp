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
        var days = program.Days!;

        Assert.Equal(["Upper", "Lower", "Rest Day", "Upper", "Lower", "Rest Day"], days.Select(day => day.DayName));
        Assert.Equal([1, 1, 1, 2, 2, 2], days.Select(day => day.WeekNumber));
        var pulldown = days[0].Exercises[0];
        Assert.Equal(("Lat Pulldown", "A1", 3), (pulldown.SourceName, pulldown.SequenceGroup, pulldown.Sets.Count));
        Assert.Equal([8d, 8d, 9d], pulldown.Sets.Select(set => set.TargetRpe));
        Assert.Equal("Long-length Partials", pulldown.Sets[^1].Notes);
        Assert.Null(pulldown.Sets[0].Notes);
        Assert.Null(days[1].Exercises[0].Sets[^1].Notes);
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

        var program = ImportTableEvidence.ReadPrintedSection(ImportPrintedSchedule.Read(pages)!.Days, Text(pages));
        Assert.NotNull(program);
        var squat = Assert.Single(program!.Days!.Single(day => day.DayName == "Lower" && day.WeekNumber == 1).Exercises,
            exercise => exercise.SourceName == "Hack Squat");
        Assert.Equal(2, squat.Sets.Count);
        Assert.Contains("Printed working-set prescription: 2 or 3", squat.CoachingNotes);
    }

    [Fact]
    public void A_mixed_section_keeps_complete_clean_pages_local_and_leaves_the_ambiguous_page_for_reading()
    {
        var pages = Book();
        pages[2] = pages[2] with
        {
            Text = pages[2].Text.Replace("Hack Squat | N/A | 2 | 2 | 6-8", "Hack Squat | N/A | 2 | two-ish | 6-8", StringComparison.Ordinal)
        };
        var schedule = ImportPrintedSchedule.Read(pages)!;
        var evidence = ImportTableEvidence.Analyze(Text(pages));

        var local = ImportTableEvidence.ReadPrintedPages(schedule.Days, evidence, 1, 7);

        Assert.NotNull(local);
        Assert.Equal([4, 6, 7], local!.Pages.Order());
        Assert.Equal(["Upper", "Upper", "Lower"],
            local.Program.Days!.Where(day => !day.IsRestDay).Select(day => day.DayName));
        Assert.DoesNotContain(local.Program.Days!, day => day.SourcePage == 5);
        Assert.Contains(evidence.Pages[5].Rows, row => !row.Prose);
    }

    [Fact]
    public void Incidental_instructions_to_run_a_program_do_not_force_an_outline_read()
    {
        var pages = Book();
        pages[0] = pages[0] with { Text = "You can run the rest of the program as is.\n" + pages[0].Text };

        var outline = ImportSourceAnalysis.Create(pages).ReadLocalOutline();

        Assert.NotNull(outline);
        Assert.Single(outline!.Chunks);
    }

    [Fact]
    public void Explicit_choice_between_programs_keeps_the_outline_read()
    {
        var pages = Book();
        pages[0] = pages[0] with { Text = "Choose between the upper/lower program and the full-body split.\n" + pages[0].Text };

        Assert.Null(ImportSourceAnalysis.Create(pages).ReadLocalOutline());
    }

    [Fact]
    public async Task A_book_printed_entirely_as_clean_tables_skips_the_outline_and_section_reads()
    {
        var pages = Book();
        var calls = 0;
        var handler = new StubHandler(_ =>
        {
            Interlocked.Increment(ref calls);
            return new HttpResponseMessage(HttpStatusCode.InternalServerError);
        });
        await using var harness = await Harness.Create(new Dictionary<string, string?> { ["OpenAi:ApiKey"] = "test-key", ["OpenAi:Model"] = "gpt-5.4-mini" });
        await harness.SignIn();
        await harness.Seed(new SeedExercise("hack-squat", "Hack Squat", "Quadriceps", "Machine", "", null));
        var imports = harness.Imports(handler);

        var pending = await imports.Create(new ImportSourceInput("pure.pdf", 7, pages), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(0, calls);
        Assert.Equal(6, ready.Draft!.Workouts.Count);
        Assert.Equal(4, ready.Draft.Workouts.Count(day => !day.IsRestDay && day.Exercises.Count == 2));
        Assert.Contains(ready.ReviewIssues!, issue => issue.Code == "printed_sections_read");
        Assert.DoesNotContain(ready.ReviewIssues!, issue => issue.Severity == "warning");
    }
}
