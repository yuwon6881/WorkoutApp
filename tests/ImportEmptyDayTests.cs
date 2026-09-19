using System.Net;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A page regularly documents a day with nothing to train — "REST", "OFF", a recovery note — and
/// the read comes back with an empty exercise list and no rest-day flag, which is the document
/// saying the same thing in its own words. The section itself accepted that day and the finished
/// draft refused it with "Each workout needs between 1 and 40 exercises", at the very end of a
/// read, after every section had been paid for. Retrying re-read only the last section while the
/// day sat in the draft from an earlier one, so the import could never finish.
public sealed class ImportEmptyDayTests
{
    private const string TwoSections = """
        {"programTitle":"Nine week block","chunks":[
          {"label":"Block 1","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":2},
          {"label":"Block 2","block":"Base","phase":"Main","weekFrom":2,"weekTo":2,"pageFrom":2,"pageTo":2,"dayCount":1}]}
        """;

    private static string Training(int week, string phase, int weekday) => $$"""
        {"block":"Base","phase":"{{phase}}","weekNumber":{{week}},"phaseWeek":1,"dayName":"Week {{week}} Upper","isRestDay":false,"weekday":{{weekday}},"sourcePage":{{week}},"notes":null,"exercises":[
          {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":{{week}},"sets":[
            {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":{{week}}}]}]}
        """;

    /// The day the document prints as "REST", read as a training day with nothing in it.
    private static string Empty(int week, string phase, int weekday) => $$"""
        {"block":"Base","phase":"{{phase}}","weekNumber":{{week}},"phaseWeek":1,"dayName":"Week {{week}} Rest","isRestDay":false,"weekday":{{weekday}},"sourcePage":{{week}},"notes":"Walk if you feel like it","exercises":[]}
        """;

    private static string Days(params string[] days) => $$"""
        {"programTitle":"Nine week block","days":[{{string.Join(",", days)}}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source() => new("nippard.pdf", 2,
        Enumerable.Range(1, 2).Select(page => new ImportPageText(page, $"WEEK {page}\nBench 3x5")).ToList());

    private sealed class SectionHandler(Func<string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => respond(request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct));
    }

    private static HttpResponseMessage Answer(string payload) => new(HttpStatusCode.OK)
    {
        Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(payload)}}}]}]}""")
    };

    [Fact]
    public async Task A_day_read_with_no_exercises_becomes_the_rest_day_it_describes()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        // The first section holds the rest day, so nothing a retry of the last section reads can
        // reach it: this is exactly the import that could never finish.
        var imports = h.Imports(new SectionHandler(request =>
            request.Contains("training_program_outline") ? Answer(TwoSections)
            : request.Contains("weeks 1-1") ? Answer(Days(Training(1, "Intro", 1), Empty(1, "Intro", 3)))
            : Answer(Days(Training(2, "Main", 1)))));

        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var rest = ready.Draft!.Workouts.Single(day => day.Name == "Week 1 Rest");
        Assert.True(rest.IsRestDay);
        Assert.Empty(rest.Exercises);
        // What the page said about the day is kept; only its shape changed.
        Assert.Equal("Walk if you feel like it", rest.Notes);
        Assert.Contains(ready.ReviewIssues!, issue => issue.Code == "day_without_exercises");
        Assert.Equal(2, ready.Draft.Workouts.Count(day => !day.IsRestDay));
    }

    [Fact]
    public void An_empty_day_is_reshaped_where_a_rest_day_and_a_trained_day_are_left_alone()
    {
        var trained = new DraftWorkout(Guid.NewGuid(), 1, "Week 1 Upper", null, null,
            [new DraftExercise(Guid.NewGuid(), "Bench press", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)]);
        var rest = new DraftWorkout(Guid.NewGuid(), 1, "Week 1 Rest", null, null, [], IsRestDay: true);
        var empty = new DraftWorkout(Guid.NewGuid(), 1, "Week 1 Off", null, null, []);

        var shaped = ImportDayShape.Reconcile([trained, rest, empty]);

        Assert.Equal([false, true, true], shaped.Workouts.Select(day => day.IsRestDay));
        var notice = Assert.Single(shaped.Notices);
        Assert.Equal("day_without_exercises", notice.Code);
        Assert.Contains("Week 1 Off", notice.Message);
    }

    [Fact]
    public void A_training_day_with_accidental_rest_day_pseudo_exercise_is_cleaned_and_splits_rest_day()
    {
        var dayWithPseudoRest = new DraftWorkout(Guid.NewGuid(), 1, "Day 1 Upper", null, null,
            [
                new DraftExercise(Guid.NewGuid(), "Bench press", null, null, [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1),
                new DraftExercise(Guid.NewGuid(), "Rest Day", null, null, [], "A2", [], 1)
            ]);

        var shaped = ImportDayShape.Reconcile([dayWithPseudoRest]);

        Assert.Equal(2, shaped.Workouts.Count);
        var training = shaped.Workouts[0];
        var rest = shaped.Workouts[1];

        Assert.False(training.IsRestDay);
        Assert.Single(training.Exercises);
        Assert.Equal("Bench press", training.Exercises[0].SourceName);

        Assert.True(rest.IsRestDay);
        Assert.Empty(rest.Exercises);
        Assert.Equal("Rest Day", rest.Name);
        Assert.DoesNotContain(shaped.Notices, n => n.Code == "exercise_without_sets");
    }
}
