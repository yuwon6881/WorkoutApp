using System.Net;
using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportCoachingEffortTests
{
    [Fact]
    public async Task Coached_effort_survives_program_creation_start_and_logging()
    {
        await using var h = await Harness.Create(new() { ["OpenAi:ApiKey"] = "test-key", ["OpenAi:Model"] = "local" });
        await h.SignIn();
        await h.Seed(new SeedExercise("lat-pulldown", "Lat Pulldown", "Back", "Cable", null));
        const string note = "Do 4 feeder sets of 10 reps. Set 1 is light (RPE 4-5). Set 2 is heavier (RPE 6-7). Set 3 is heavier again (RPE 7-8). Set 4 is your hard set: try to hit failure at 10 reps on this last set.";
        const string outline = """
            {"programTitle":"Feeder program","chunks":[{"label":"Week 1","block":null,"phase":null,"weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
            """;
        const string section = """
            {"programTitle":"Feeder program","days":[{"weekNumber":1,"phaseWeek":1,"dayName":"Pull 1","isRestDay":false,"sourcePage":1,"exercises":[{"sourceName":"Lat Pulldown","sourcePage":1,"sets":[]}]}]}
            """;
        var imports = h.Imports(new StubHandler(request =>
        {
            var body = request.Content?.ReadAsStringAsync().GetAwaiter().GetResult() ?? "";
            var answer = body.Contains("training_program_outline", StringComparison.Ordinal) ? outline : section;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(answer)}}}]}]}""")
            };
        }));
        var source = new ImportSourceInput("feeder.pdf", 1, [new ImportPageText(1,
            $"WEEK 1\nDAY LABEL: Pull 1\nExercise | Warm-up Sets | Working Sets | Reps | RPE | Rest | Notes\nLat Pulldown | 0 | 4 | 10 | See Notes | 2-3 min | {note}")],
            [new ImportPageLink(1, "Lat Pulldown", "https://youtu.be/O94yEoGXtBY?t=150")]);
        var pending = await imports.Create(source, default);
        var ready = pending.Status == ImportStatus.Pending ? await imports.Extract(pending.Id, default) : pending;
        Assert.True(ready.Acceptable);
        var program = await imports.Accept(ready.Id, default);
        var template = Assert.Single(program.Workouts);
        var plans = Assert.Single(template.Exercises).Sets;
        Assert.Equal(new double?[] { null, 7, 8, 10 }, plans.Select(set => set.TargetRpe));
        Assert.Equal(["5+", "3", "2", "0"], plans.Select(set => set.Rir));
        var active = await h.Programs.SetActive(program.Id, true, program.Revision, default);
        var session = await h.Workouts.Start(Assert.Single(active.Workouts).Id, null, default);
        var exercise = Assert.Single(session.Exercises);
        Assert.Equal("5+", exercise.Prescription[0].Rir);
        Assert.Equal("Printed RPE: 4-5", exercise.Prescription[0].Notes);
        Assert.Equal("https://youtu.be/O94yEoGXtBY?t=150", exercise.DemoUrl);
        using var patch = JsonDocument.Parse($$"""{"revision":{{session.Revision}},"mutationId":"{{Guid.NewGuid()}}","weightKg":30,"reps":10,"rir":"5+","done":true}""");
        var logged = await h.Workouts.PatchSet(session.Id, exercise.Sets[0].Id, patch.RootElement.Clone(), default);
        Assert.Equal("5+", logged.Exercises[0].Sets[0].Rir);
        var finished = await h.Workouts.Finish(session.Id, logged.Revision, default);
        Assert.Equal("5+", finished.Exercises[0].Sets[0].Rir);
    }

    [Theory]
    [InlineData("Last set taken to failure, 1-2 effective cheat reps at end of set")]
    [InlineData("Take the last set to failure")]
    [InlineData("On the last set only: do 10 reps to failure. Rest 3-4 seconds. Do another 3 reps")]
    public void Final_set_coaching_narrows_row_wide_effort(string note)
    {
        var exercise = Read("9", note, 3);
        Assert.Equal([9d, 9d, 10d], exercise.Sets.Select(set => set.TargetRpe!.Value));
        Assert.Equal(["1", "1", "0"], exercise.Sets.Select(set => set.Rir));
        Assert.Equal(note, exercise.CoachingNotes);
    }

    [Theory]
    [InlineData("Do not take the last set to failure")]
    [InlineData("Last set: stop shy of failure")]
    [InlineData("Avoid failure on the last set")]
    [InlineData("After failure, hold the position for 15 seconds")]
    [InlineData("Go heavier on set 2 if set 1 is RPE 7 or lower")]
    public void Negative_or_unscoped_discussion_does_not_override_effort(string note)
        => Assert.All(Read("9", note, 3).Sets, set => Assert.Equal(9, set.TargetRpe));

    [Fact]
    public void Indexed_feeder_effort_keeps_low_range_without_clamping_it_to_rpe_six()
    {
        const string note = "Do 4 feeder sets of 10 reps. Set 1 is light (RPE 4-5). Set 2 is heavier (RPE 6-7). Set 3 is heavier again (RPE 7-8). Set 4 is your hard set: try to hit failure at 10 reps on this last set.";
        var exercise = Read("See Notes", note, 4);
        Assert.Equal(new double?[] { null, 7, 8, 10 }, exercise.Sets.Select(set => set.TargetRpe));
        Assert.Equal(["5+", "3", "2", "0"], exercise.Sets.Select(set => set.Rir));
        Assert.Equal("Printed RPE: 4-5", exercise.Sets[0].Notes);
        Assert.Equal(4, exercise.Sets.Count);
        Assert.Equal(note, exercise.CoachingNotes);
    }

    [Fact]
    public void Conflicting_indexed_values_are_not_chosen_arbitrarily()
        => Assert.Null(Read("See Notes", "Set 1: RPE 7. Set 1: RPE 9.", 1).Sets[0].TargetRpe);

    [Theory]
    [InlineData("Set 4: RPE 7.")]
    [InlineData("Set 99999999999999999: RPE 7.")]
    public void Notes_for_nonexistent_sets_do_not_change_existing_sets(string note)
        => Assert.All(Read("9", note, 3).Sets, set => Assert.Equal(9, set.TargetRpe));

    private static AiExercise Read(string effort, string note, int count)
    {
        var program = new AiProgram("Example", [new AiDay(null, null, 1, 1, "Day 1", false, null,
            [new AiExercise("Lat Pulldown", null, null, [], SourcePage: 1)], 1)]);
        var source = $"=== PAGE 1 ===\nDAY LABEL: DAY 1\nExercise | Sets | Reps | RPE | Rest | Notes\nLat Pulldown | {count} | 10 | {effort} | 2 MIN | {note}";
        return Assert.Single(Assert.Single(ImportTableEvidence.Enrich(program, source).Days!).Exercises);
    }
}
