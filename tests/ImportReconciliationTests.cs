using System.Net;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The outline estimates each section's size from page previews, and an estimate made that way is
/// regularly wrong — a section headed "Front matter and program explanation" reads as fifteen
/// training days and contains seven. Rejecting the section over that number threw away a read the
/// user had already paid for and left the import stuck on a chunk that would fail the same way
/// every time. What the outline claimed about a section is reconciled with what the section read
/// and reported for review; only a read that genuinely did not happen still fails.
public sealed class ImportReconciliationTests
{
    /// One page, so the section is small enough to read whole and stays exactly as the outline
    /// drew it; what is under test here is the estimate, not how a long section is divided.
    private const string Outline = """
        {"programTitle":"Nine week block","chunks":[
          {"label":"Front matter and program explanation","block":"Base","phase":"Intro","weekFrom":1,"weekTo":2,"pageFrom":1,"pageTo":1,"dayCount":15}]}
        """;

    private const string OutlineOverTwoPages = """
        {"programTitle":"Nine week block","chunks":[
          {"label":"Week 1","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1},
          {"label":"Photographs","block":"Base","phase":"Intro","weekFrom":2,"weekTo":2,"pageFrom":3,"pageTo":3,"dayCount":4}]}
        """;

    private static string Days(params (int Week, string Name)[] days)
        => Days(days.Select(d => (d.Week, d.Name, 1)).ToArray());

    private static string Days(params (int Week, string Name, int Page)[] days) => $$"""
        {"programTitle":"Nine week block","days":[{{string.Join(",", days.Select(day => $$"""
          {"block":"Base","phase":"Intro","weekNumber":{{day.Week}},"phaseWeek":{{day.Week}},"dayName":"{{day.Name}}","isRestDay":false,"weekday":1,"sourcePage":{{day.Page}},"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":{{day.Page}},"sets":[
              {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":{{day.Page}}}]}]}
        """))}}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static StubHandler Reading(params string[] bodies)
    {
        var call = 0;
        return new StubHandler(_ =>
        {
            var body = bodies[Math.Min(call++, bodies.Length - 1)];
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(body)}}}]}]}""")
            };
        });
    }

    [Fact]
    public async Task A_section_that_reads_shorter_than_the_outline_estimated_is_kept_and_reported()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 2\nBench 3x5")]);
        var imports = h.Imports(Reading(Outline, Days((1, "Day A"), (2, "Day B"))));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, ready.Draft!.Workouts.Count);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "chunk_day_count");
        Assert.Contains("about 15 days but reads as 2", notice.Message);
        Assert.Equal("warning", notice.Severity);
        Assert.False(ready.Acceptable);
    }

    [Fact]
    public void Page_46_outline_estimate_uses_its_one_printed_day_instead_of_warning_about_seven()
    {
        var extracted = new ImportDraft("Pure Bodybuilding", [ReconciliationDay(46) with
        {
            Week = 6,
            Name = "Pull #1"
        }]);
        var pages = new[] { new ImportPageText(46, "BLOCK 2: 5-WEEK GRIND PHASE\nWEEK 6\nDAY LABEL: Pull #1") };
        var chunk = new ImportChunk("BLOCK 2: 5-WEEK GRIND PHASE", "Block 2", "Grind", 6, 10, 46, 46, 7);

        var merge = ImportChunkReconciliation.ReconcileChunkCoverage(new ImportDraft("Pure Bodybuilding", []), extracted, chunk, pages);

        Assert.DoesNotContain(merge.Notices, issue => issue.Code == "chunk_day_count");
    }

    [Fact]
    public void Chunk_with_many_printed_day_labels_still_warns_when_the_read_misses_most_of_them()
    {
        var pages = Enumerable.Range(46, 8)
            .Select(page => new ImportPageText(page, $"WEEK 6\nDAY LABEL: Session {page}"))
            .ToList();
        var extracted = new ImportDraft("Pure Bodybuilding", [ReconciliationDay(46) with { Week = 6 }]);
        var chunk = new ImportChunk("Week 6", "Block 2", "Grind", 6, 6, 46, 53, 7);

        var merge = ImportChunkReconciliation.ReconcileChunkCoverage(new ImportDraft("Pure Bodybuilding", []), extracted, chunk, pages);

        var warning = Assert.Single(merge.Notices, issue => issue.Code == "chunk_day_count");
        Assert.Contains("8 printed training-day titles but reads as 1", warning.Message);
    }

    /// The outline's week range is a claim made from page previews; the page the section actually
    /// read is the better authority. Refusing the section over the disagreement only produced the
    /// same answer on every retry, so the page is followed and the reviewer is told.
    [Fact]
    public async Task A_day_whose_week_falls_outside_the_sections_range_is_kept_and_reported()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 2\nBench 3x5")]);
        var imports = h.Imports(Reading(Outline, Days((9, "Day A"))));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(9, ready.Draft!.Workouts.Single().Week);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "day_outside_section_weeks");
        Assert.Contains("Day A", notice.Message);
        Assert.Equal("warning", notice.Severity);
    }

    [Fact]
    public async Task A_section_whose_pages_hold_no_text_is_skipped_with_a_note_instead_of_stalling()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        // Page 3 is a photo spread: the browser found no text there, so it was never submitted.
        var source = new ImportSourceInput("nippard.pdf", 3, [new ImportPageText(1, "WEEK 1\nBench 3x5")]);
        var stub = Reading(OutlineOverTwoPages, Days((1, "Day A")));
        var imports = h.Imports(stub);

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, ready.ChunksDone);
        Assert.Single(ready.Draft!.Workouts);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "section_without_text");
        Assert.Contains("Photographs", notice.Message);
        // The skipped section costs nothing: only the outline and the one real section were read.
        Assert.Equal(2, stub.Calls);
    }

    /// A coached program routinely lists three or four alternates for one movement. The importer
    /// keeps the two an exercise can hold, so the length of that list must never be the reason a
    /// whole section is rejected — which is what "An exercise can have at most 2 substitutions"
    /// did to the first section of a real import.
    [Fact]
    public async Task An_exercise_offering_more_alternates_than_it_can_hold_is_still_read()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var manyAlternates = """
            {"programTitle":"Nine week block","days":[
              {"block":"Base","phase":"Intro","weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
                {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,
                 "substitutions":["Incline dumbbell press","Machine chest press","Push-up","Floor press"],"sets":[
                  {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
            """;
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 2\nBench 3x5")]);
        var imports = h.Imports(Reading(Outline, manyAlternates));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var exercise = ready.Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal(["Incline dumbbell press", "Machine chest press"], exercise.Substitutions);
        // The alternates that do not fit are still written down rather than dropped.
        Assert.Contains("Other alternates: Push-up, Floor press", exercise.Notes);
    }

    /// A program that runs the same session twice in one week, with no weekday printed next to
    /// either, produces two days that read identically. That is what the document says, not a
    /// defect, and refusing the section over it stranded a real import on its third block.
    [Fact]
    public async Task Two_days_that_read_identically_are_both_kept_and_reported()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 2\nBench 3x5")]);
        var twoDistinctConditioning = """
            {"programTitle":"Nine week block","days":[
              {"block":"Base","phase":"Intro","weekNumber":1,"phaseWeek":1,"dayName":"Conditioning","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
                {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,"sets":[
                  {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]},
              {"block":"Base","phase":"Intro","weekNumber":1,"phaseWeek":1,"dayName":"Conditioning","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
                {"sequenceGroup":"A1","sourceName":"Dumbbell curl","exerciseId":null,"notes":null,"sourcePage":1,"sets":[
                  {"repMin":10,"repMax":12,"targetRpe":8,"restSeconds":60,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}
            ]}
            """;
        var imports = h.Imports(Reading(Outline, twoDistinctConditioning));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, ready.Draft!.Workouts.Count);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "repeated_day");
        Assert.Contains("delete one in the review", notice.Message);
    }

    [Fact]
    public async Task Two_days_that_read_identically_on_same_page_are_collapsed()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var source = new ImportSourceInput("nippard.pdf", 1, [new ImportPageText(1, "WEEK 1\nBench 3x5")]);
        var imports = h.Imports(Reading(Outline, Days((1, "Conditioning", 1), (1, "Conditioning", 1))));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Single(ready.Draft!.Workouts);
        Assert.DoesNotContain(ready.ReviewIssues ?? [], issue => issue.Code == "repeated_day");
    }

    /// A section that repeats a day an earlier section already read is the one duplicate worth
    /// acting on: merging it would put the same session in the program twice.
    [Fact]
    public async Task A_day_an_earlier_section_already_read_is_kept_only_once()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var overlapping = """
            {"programTitle":"Nine week block","chunks":[
              {"label":"Week 1 pages","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1},
              {"label":"Week 1 continued","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":2,"pageTo":2,"dayCount":1}]}
            """;
        var source = new ImportSourceInput("nippard.pdf", 2,
            [new ImportPageText(1, "WEEK 1\nBench 3x5"), new ImportPageText(2, "WEEK 1\nBench 3x5 again")]);
        var imports = h.Imports(Reading(overlapping, Days((1, "Day A")), Days((1, "Day A"))));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Single(ready.Draft!.Workouts);
        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "duplicate_day_dropped");
        Assert.Contains("kept once", notice.Message);
        Assert.Equal("info", notice.Severity);
    }

    [Fact]
    public async Task Repeated_day_label_ambiguity_across_sections_is_recorded_once()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var outline = """
            {"programTitle":"Nine week block","chunks":[
              {"label":"Week 1 part 1","block":null,"phase":null,"weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":2},
              {"label":"Week 1 part 2","block":null,"phase":null,"weekFrom":1,"weekTo":1,"pageFrom":2,"pageTo":2,"dayCount":2}]}
            """;
        var source = new ImportSourceInput("nippard.pdf", 2, [
            new ImportPageText(1, "WEEK 1\nDAY LABEL: Upper 1\nExercise | Sets | Reps"),
            new ImportPageText(2, "WEEK 1\nDAY LABEL: Upper 1\nExercise | Sets | Reps")
        ]);
        var imports = h.Imports(Reading(outline, Days((1, "Model A", 1), (1, "Model B", 1)),
            Days((1, "Model C", 2), (1, "Model D", 2))));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        var notice = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "day_label_ambiguous");
        Assert.Equal(2, notice.SourcePage);
        Assert.Equal(4, ready.Draft!.Workouts.Count);
    }

    [Fact]
    public void Earlier_section_duplicates_are_aggregated_and_coverage_uses_pre_deduplication_days()
    {
        var existingDays = Enumerable.Range(3, 3).Select(page => ReconciliationDay(page)).ToList();
        var existing = new ImportDraft("Program", existingDays);
        var extracted = new ImportDraft("Program", existingDays.Select(day => day with { LineId = Guid.NewGuid() }).ToList());
        var chunk = new ImportChunk("Overlapping section", null, null, 1, 1, 3, 5, 6);

        var merge = ImportChunkReconciliation.ReconcileChunkCoverage(existing, extracted, chunk);

        Assert.Empty(merge.Workouts);
        var duplicate = Assert.Single(merge.Notices, issue => issue.Code == "duplicate_day_dropped");
        Assert.Equal("info", duplicate.Severity);
        Assert.Contains("repeated 3 days", duplicate.Message);
        Assert.DoesNotContain(merge.Notices, issue => issue.Code == "chunk_day_count");
    }

    private static DraftWorkout ReconciliationDay(int page)
        => new(Guid.NewGuid(), 1, $"Day {page}", null, null, [
            new DraftExercise(Guid.NewGuid(), "Bench Press", null, null,
                [new DraftSet(6, 8, 8, 90, null, null, null, SourcePage: page)], SourcePage: page)
        ], SourcePage: page);

    [Fact]
    public void Trailing_rest_rows_beyond_seven_days_are_discarded()
    {
        var days = Enumerable.Range(1, 7)
            .Select(i => new DraftWorkout(Guid.NewGuid(), 1, $"Day {i}", null, null,
                [new DraftExercise(Guid.NewGuid(), "Bench", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)],
                Block: "Block 1", Phase: "Phase 1"))
            .ToList();
        var rest1 = new DraftWorkout(Guid.NewGuid(), 1, "Rest 1", null, null, [], Block: "Block 1", Phase: "Phase 1", IsRestDay: true);
        var rest2 = new DraftWorkout(Guid.NewGuid(), 1, "Rest 2", null, null, [], Block: "Block 1", Phase: "Phase 1", IsRestDay: true);
        days.Add(rest1);
        days.Add(rest2);

        var (workouts, notices) = ImportDayShape.Reconcile(days);

        Assert.Equal(7, workouts.Count);
        Assert.All(workouts, w => Assert.False(w.IsRestDay));
        Assert.DoesNotContain(notices, n => n.Code == "week_day_overflow");
    }

    [Fact]
    public void An_untitled_rest_day_keeps_its_shape_owned_name()
    {
        var rest = new DraftWorkout(Guid.NewGuid(), 1, "", null, null, [], IsRestDay: true, SourcePage: 73);

        var (workouts, _) = ImportDayShape.Reconcile([rest]);

        Assert.Equal("Rest Day", Assert.Single(workouts).Name);
    }

    [Fact]
    public void Trailing_rest_rows_beyond_seven_days_preserve_source_order_and_first_seven_rows()
    {
        var d1 = new DraftWorkout(Guid.NewGuid(), 1, "Day 1", null, null, [new DraftExercise(Guid.NewGuid(), "Squat", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)], Block: "B", Phase: "P");
        var r1 = new DraftWorkout(Guid.NewGuid(), 1, "Rest 1", null, null, [], Block: "B", Phase: "P", IsRestDay: true);
        var d2 = new DraftWorkout(Guid.NewGuid(), 1, "Day 2", null, null, [new DraftExercise(Guid.NewGuid(), "Bench", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)], Block: "B", Phase: "P");
        var r2 = new DraftWorkout(Guid.NewGuid(), 1, "Rest 2", null, null, [], Block: "B", Phase: "P", IsRestDay: true);
        var d3 = new DraftWorkout(Guid.NewGuid(), 1, "Day 3", null, null, [new DraftExercise(Guid.NewGuid(), "Row", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)], Block: "B", Phase: "P");
        var d4 = new DraftWorkout(Guid.NewGuid(), 1, "Day 4", null, null, [new DraftExercise(Guid.NewGuid(), "Press", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)], Block: "B", Phase: "P");
        var d5 = new DraftWorkout(Guid.NewGuid(), 1, "Day 5", null, null, [new DraftExercise(Guid.NewGuid(), "Deadlift", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)], Block: "B", Phase: "P");
        var trailingRest1 = new DraftWorkout(Guid.NewGuid(), 1, "Rest 3", null, null, [], Block: "B", Phase: "P", IsRestDay: true, SourcePage: 71);
        var trailingRest2 = new DraftWorkout(Guid.NewGuid(), 1, "Rest 4", null, null, [], Block: "B", Phase: "P", IsRestDay: true, SourcePage: 72);

        var (workouts, notices) = ImportDayShape.Reconcile([d1, r1, d2, r2, d3, d4, d5, trailingRest1, trailingRest2]);

        Assert.Equal(7, workouts.Count);
        Assert.Equal(["Day 1", "Rest 1", "Day 2", "Rest 2", "Day 3", "Day 4", "Day 5"], workouts.Select(w => w.Name));
        Assert.DoesNotContain(notices, n => n.Code == "week_day_overflow");
        var trimNotice = Assert.Single(notices, n => n.Code == "trailing_rest_day_trimmed");
        Assert.Equal("info", trimNotice.Severity);
        Assert.Equal(71, trimNotice.SourcePage);
    }

    [Fact]
    public void Training_rows_overflowing_seven_days_are_retained_in_shape_reconciliation()
    {
        var days = Enumerable.Range(1, 8)
            .Select(i => new DraftWorkout(Guid.NewGuid(), 1, $"Day {i}", null, null,
                [new DraftExercise(Guid.NewGuid(), "Bench", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)],
                Block: "Block 1", Phase: "Phase 1"))
            .ToList();

        var (workouts, notices) = ImportDayShape.Reconcile(days);

        Assert.Equal(8, workouts.Count);
        Assert.Equal("Day 8", workouts[7].Name);
        Assert.Empty(notices);
    }

    [Fact]
    public void Identical_sessions_from_different_source_pages_remain_ambiguous()
    {
        var days = Enumerable.Range(1, 8)
            .Select(page => new DraftWorkout(Guid.NewGuid(), 1, "Lower 1", null, null,
                [new DraftExercise(Guid.NewGuid(), "Squat", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], page)],
                Block: "Block 1", Phase: "Phase 1", SourcePage: page))
            .ToList();

        var (workouts, notices) = ImportDayShape.Reconcile(days);

        Assert.Equal(8, workouts.Count);
        Assert.Empty(notices);
    }

    [Fact]
    public void ImportValidation_ReviewIssues_flags_overflow_rows_with_blocking_issue()
    {
        var days = Enumerable.Range(1, 8)
            .Select(i => new DraftWorkout(Guid.NewGuid(), 1, $"Day {i}", null, null,
                [new DraftExercise(Guid.NewGuid(), "Bench", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)],
                Block: "Block 1", Phase: "Phase 1"))
            .ToList();

        var draft = new ImportDraft("Program", days);
        var issues = ImportValidation.ReviewIssues(draft);

        var issue = Assert.Single(issues, i => i.Code == "week_day_overflow");
        Assert.Equal("warning", issue.Severity);
        Assert.Equal(days[7].LineId, issue.WorkoutLineId);
    }

    [Fact]
    public void ImportValidation_ReviewIssues_counts_days_across_phases_and_blocks()
    {
        var days = Enumerable.Range(1, 8)
            .Select(i => new DraftWorkout(Guid.NewGuid(), 1, $"Day {i}", null, null,
                [new DraftExercise(Guid.NewGuid(), "Bench", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)],
                Block: i <= 4 ? "Block 1" : "Block 2", Phase: i <= 4 ? "Phase 1" : "Phase 2"))
            .ToList();

        var issues = ImportValidation.ReviewIssues(new ImportDraft("Program", days));

        var issue = Assert.Single(issues, i => i.Code == "week_day_overflow");
        Assert.Equal(days[7].LineId, issue.WorkoutLineId);
    }

    [Fact]
    public async Task Overflow_review_issue_is_single_source_blocks_acceptance_and_clears_on_edit()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null));

        var eightDays = Days(Enumerable.Range(1, 8).Select(i => (1, $"Day {i}", 1)).ToArray());
        var source = new ImportSourceInput("overflow.pdf", 1, [new ImportPageText(1, "WEEK 1\nBarbell bench press 3x5")]);
        var imports = h.Imports(Reading(Outline, eightDays));

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(8, ready.Draft!.Workouts.Count);

        // Exactly one issue is exposed, not duplicated between persisted notices and live validation
        var overflowIssue = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "week_day_overflow");
        Assert.Equal("warning", overflowIssue.Severity);
        Assert.False(ready.Acceptable);

        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Accept(ready.Id, default));
        Assert.Equal(409, failure.Status);

        // Moving Day 8 to week 2 clears the 7-day week overflow
        var day8 = ready.Draft.Workouts[7];
        var editedWorkouts = ready.Draft.Workouts.Take(7).Append(day8 with { Week = 2, PhaseWeek = 2 }).ToList();
        var editedDraft = ready.Draft with { Workouts = editedWorkouts };

        var saved = await imports.Edit(ready.Id, editedDraft, default);
        Assert.DoesNotContain(saved.ReviewIssues ?? [], issue => issue.Code == "week_day_overflow");
        Assert.True(saved.Acceptable);

        var accepted = await imports.Accept(ready.Id, default);
        Assert.Equal(ProgramLifecycle.Standby, accepted.LifecycleStatus);
    }
}
