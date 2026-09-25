using System.Net;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A document labels a phase — a deload week most of all — while letting the block's week counter
/// run on, so a one-week deload arrives as "phase week five". That is the document's numbering
/// convention, not a missing week, but it failed the finished draft with "Phase 'Deload Week' has
/// a missing phase week" at the very end of a read, after every section had been paid for.
public sealed class ImportPhaseWeekTests
{
    private const string Outline = """
        {"programTitle":"Nine week block","chunks":[
          {"label":"Block 1","block":"Block 1","phase":"Accumulation","weekFrom":1,"weekTo":5,"pageFrom":1,"pageTo":1,"dayCount":2}]}
        """;

    private static string Days(params (int Week, int PhaseWeek, string Phase)[] days) => $$"""
        {"programTitle":"Nine week block","days":[{{string.Join(",", days.Select(day => $$"""
          {"block":"Block 1","phase":"{{day.Phase}}","weekNumber":{{day.Week}},"phaseWeek":{{day.PhaseWeek}},"dayName":"Week {{day.Week}} Upper","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}
        """))}}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source() => new("nippard.pdf", 1, [new ImportPageText(1,
        "BLOCK 1\nACCUMULATION\nWEEK 4\nBarbell bench press 3x5\nDELOAD WEEK\nWEEK 5\nBarbell bench press 3x5")]);

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
    public async Task A_deload_phase_that_kept_the_blocks_week_numbering_is_renumbered_and_reported()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        // Week 4 accumulates, week 5 is its own one-week deload phase still numbered "5".
        var imports = h.Imports(Reading(Outline, Days((4, 4, "Accumulation"), (5, 5, "Deload Week"))));

        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var deload = Assert.Single(ready.Draft!.Workouts, day => day.Phase == "Deload Week");
        Assert.Equal(1, deload.PhaseWeek);
        // The week the document stated is untouched; only the count inside the phase moved.
        Assert.Equal(5, deload.Week);
        var issue = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "phase_week_renumbered");
        Assert.Equal("info", issue.Severity);
    }

    [Fact]
    public async Task Phase_week_renumbered_is_informational_and_does_not_block_acceptance()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "", null));
        var imports = h.Imports(Reading(Outline, Days((4, 4, "Accumulation"), (5, 5, "Deload Week"))));

        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var issue = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "phase_week_renumbered");
        Assert.Equal("info", issue.Severity);
        Assert.Empty(ready.Unresolved);
        Assert.True(ready.Acceptable);
    }

    [Fact]
    public async Task A_phase_that_skips_a_week_fails_with_a_specific_retained_explanation()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        // Weeks 1 and 3 of one phase: week 2 has no days at all in the document.
        var imports = h.Imports(Reading(Outline, Days((1, 1, "Accumulation"), (3, 2, "Accumulation"))));

        var pending = await imports.Create(Source(), default);
        var failure = await Assert.ThrowsAsync<ImportVerificationException>(() => imports.Extract(pending.Id, default));
        Assert.Contains("phase_week_gap", failure.Message);

        var failed = await imports.Get(pending.Id, default);
        Assert.Equal(ImportStatus.Failed, failed.Status);
        var issue = Assert.Single(failed.ReviewIssues!, issue => issue.Code == "phase_week_gap");
        Assert.Contains("jumps from week 1 to week 3", issue.Message);
        Assert.Equal("warning", issue.Severity);
        Assert.Equal(2, failed.Draft!.Workouts.Count);
    }

    [Fact]
    public void A_missing_week_between_phases_is_flagged_in_import_review()
    {
        var draft = new ImportDraft("Program",
        [
            Day(1, 1, "Accumulation"),
            Day(3, 1, "Deload Week")
        ]);

        var issues = ImportValidation.ReviewIssues(draft);

        var issue = Assert.Single(issues, issue => issue.Code == "program_week_gap");
        Assert.Contains("Program week 2 has no days", issue.Message);
        Assert.Equal("warning", issue.Severity);
    }

    [Fact]
    public void Renumbering_counts_each_phase_from_one_and_leaves_a_correct_draft_alone()
    {
        var accumulation = Day(1, 1, "Accumulation");
        var deload = Day(2, 2, "Deload Week");
        var (renumbered, changed) = ImportValidation.NormalizePhaseWeeks([accumulation, deload]);
        Assert.True(changed);
        Assert.Equal([1, 1], renumbered.Select(day => day.PhaseWeek));

        var correct = new List<DraftWorkout> { Day(1, 1, "Accumulation"), Day(2, 2, "Accumulation") };
        var (untouched, unchanged) = ImportValidation.NormalizePhaseWeeks(correct);
        Assert.False(unchanged);
        Assert.Equal([1, 2], untouched.Select(day => day.PhaseWeek));
    }

    [Fact]
    public void A_repeated_block_banner_continues_the_preceding_run_and_is_reported()
    {
        var days = new[] { Day(1, 1, "Accumulation") with { Block = "Block 1" },
            Day(6, 6, "Accumulation") with { Block = "Block 1" },
            Day(7, 1, "Deload Week") with { Block = "Block 2", SourcePage = 55 },
            Day(8, 1, "Accumulation") with { Block = "Block 1", SourcePage = 61 },
            Day(12, 5, "Accumulation") with { Block = "Block 1" } };

        var result = ImportBlockRuns.Reconcile(days);

        Assert.Equal(["Block 1", "Block 1", "Block 2", "Block 2", "Block 2"],
            result.Workouts.Select(day => day.Block));
        Assert.Contains(result.Notices, notice => notice.Code == "block_label_repeated"
            && notice.SourcePage == 61 && notice.Severity == "info");
        Assert.Equal(days.Select(day => (day.Week, day.Name)), result.Workouts.Select(day => (day.Week, day.Name)));
    }

    [Fact]
    public void Same_week_block_reappearance_is_not_rewritten()
    {
        var days = new[] { Day(1, 1, "Accumulation") with { Block = "Block 1" },
            Day(1, 1, "Accumulation") with { Block = "Block 2" },
            Day(1, 1, "Accumulation") with { Block = "Block 1" } };

        var result = ImportBlockRuns.Reconcile(days);

        Assert.Equal(["Block 1", "Block 2", "Block 1"], result.Workouts.Select(day => day.Block));
        Assert.DoesNotContain(result.Notices, notice => notice.Code == "block_label_repeated");
    }

    /// The Min-Max Phase 2 5x document prints its block banner on every week's first page and
    /// mislabels weeks 8-12 as "Block 1" after printing "Block 2" over the week 7 deload. The day
    /// level already coalesced that run; the outline refused first, because the chunk range check
    /// groups by block label and read the week 6 to week 8 jump as a skipped week.
    [Fact]
    public void A_repeated_block_banner_in_the_outline_continues_the_preceding_run()
    {
        var chunks = new[] { Chunk("Weeks 1-6", "Block 1", 1, 6, 26, 55), Chunk("Week 7", "Block 2", 7, 7, 56, 60),
            Chunk("Weeks 8-12", "Block 1", 8, 12, 61, 85) };

        // Grouped by the labels the document printed, the range check reads week 6 to week 8 as a
        // skipped week and refuses the outline before any section is read.
        var refused = Assert.Throws<DomainException>(() => ImportValidation.ValidateChunkRanges(chunks));
        Assert.Equal(422, refused.Status);
        Assert.Contains("skip a week", refused.Message);

        var result = ImportBlockRuns.ReconcileChunks(chunks);

        Assert.Equal(["Block 1", "Block 2", "Block 2"], result.Chunks.Select(chunk => chunk.Block));
        Assert.Contains(result.Notices, notice => notice.Code == "block_label_repeated"
            && notice.SourcePage == 61 && notice.Severity == "info");
        // The reconciled labels are what let the outline through the range check at all.
        ImportValidation.ValidateChunkRanges(result.Chunks);
    }

    [Fact]
    public void An_outline_block_that_never_resumes_is_left_alone()
    {
        var chunks = new[] { Chunk("Weeks 1-6", "Block 1", 1, 6, 26, 55), Chunk("Weeks 7-12", "Block 2", 7, 12, 56, 85) };

        var result = ImportBlockRuns.ReconcileChunks(chunks);

        Assert.Equal(["Block 1", "Block 2"], result.Chunks.Select(chunk => chunk.Block));
        Assert.Empty(result.Notices);
    }

    [Fact]
    public void Sequential_blocks_with_restarted_local_weeks_follow_printed_page_order()
    {
        var chunks = new[]
        {
            Chunk("Block 1 week 1", "Block 1", 1, 1, 32, 32),
            Chunk("Block 1 week 2", "Block 1", 2, 2, 35, 35),
            Chunk("Block 1 week 3", "Block 1", 3, 3, 38, 38),
            Chunk("Block 2 week 1", "Block 2", 1, 1, 41, 41),
            Chunk("Block 2 week 2", "Block 2", 2, 2, 44, 44),
            Chunk("Block 2 week 3", "Block 2", 3, 3, 47, 47)
        };

        var reconciled = ImportBlockRuns.ReconcileChunks(chunks);
        var absolute = ImportAbsoluteWeeks.NormalizeChunks(reconciled.Chunks);

        Assert.Equal(chunks.Select(chunk => chunk.Block), reconciled.Chunks.Select(chunk => chunk.Block));
        Assert.DoesNotContain(reconciled.Notices, notice => notice.Code == "block_label_repeated");
        Assert.Equal([1, 2, 3, 4, 5, 6], absolute.Chunks.Select(chunk => chunk.WeekFrom));
    }

    [Fact]
    public void Draft_block_reconciliation_keeps_consecutive_blocks_with_restarted_weeks()
    {
        var days = new[]
        {
            Day(1, 1, "Accumulation") with { Block = "Block 1", SourcePage = 32 },
            Day(2, 2, "Accumulation") with { Block = "Block 1", SourcePage = 35 },
            Day(3, 3, "Accumulation") with { Block = "Block 1", SourcePage = 38 },
            Day(1, 1, "Deload Week") with { Block = "Block 2", SourcePage = 41 },
            Day(2, 2, "Deload Week") with { Block = "Block 2", SourcePage = 44 },
            Day(3, 3, "Deload Week") with { Block = "Block 2", SourcePage = 47 }
        };

        var result = ImportBlockRuns.Reconcile(days);

        Assert.Equal(days.Select(day => day.Block), result.Workouts.Select(day => day.Block));
        Assert.DoesNotContain(result.Notices, notice => notice.Code == "block_label_repeated");
    }

    /// A phase legitimately split into page sections for the same weeks must not be read as a
    /// resumed block: the later run starts no later than the earlier one ended.
    [Fact]
    public void Outline_sections_covering_the_same_weeks_are_not_rewritten()
    {
        var chunks = new[] { Chunk("Part 1", "Block 1", 1, 2, 26, 30), Chunk("Choice", "Block 2", 1, 2, 31, 35),
            Chunk("Part 2", "Block 1", 1, 2, 36, 40) };

        var result = ImportBlockRuns.ReconcileChunks(chunks);

        Assert.Equal(["Block 1", "Block 2", "Block 1"], result.Chunks.Select(chunk => chunk.Block));
        Assert.Empty(result.Notices);
    }

    private static DraftWorkout Day(int week, int phaseWeek, string phase)
        => new(Guid.NewGuid(), week, $"Week {week} Upper", null, null, [], "Block 1", phase, phaseWeek);

    private static ImportChunk Chunk(string label, string block, int weekFrom, int weekTo, int pageFrom, int pageTo)
        => new(label, block, null, weekFrom, weekTo, pageFrom, pageTo, (weekTo - weekFrom + 1) * 5);
}
