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
        "BLOCK 1\nACCUMULATION\nWEEK 4\nBench 3x5\nDELOAD WEEK\nWEEK 5\nBench 3x5")]);

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
    public async Task A_phase_that_skips_a_week_is_flagged_for_review_rather_than_refused()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        // Weeks 1 and 3 of one phase: week 2 has no days at all in the document.
        var imports = h.Imports(Reading(Outline, Days((1, 1, "Accumulation"), (3, 2, "Accumulation"))));

        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var issue = Assert.Single(ready.ReviewIssues!, issue => issue.Code == "phase_week_gap");
        Assert.Contains("jumps from week 1 to week 3", issue.Message);
        Assert.Equal("warning", issue.Severity);
        Assert.False(ready.Acceptable);
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

    private static DraftWorkout Day(int week, int phaseWeek, string phase)
        => new(Guid.NewGuid(), week, $"Week {week} Upper", null, null, [], "Block 1", phase, phaseWeek);
}
