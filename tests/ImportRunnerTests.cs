using System.Net;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportRunnerTests
{
    private const string Outline = """
        {"programTitle":"Background import","description":null,"chunks":[
          {"label":"Week 1","block":"Base","phase":"Strength","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private const string Day = """
        {"programTitle":"Background import","description":null,"days":[
          {"block":"Base","phase":"Strength","weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
        """;

    private const string TwoChunkOutline = """
        {"programTitle":"Background import","description":null,"chunks":[
          {"label":"Week 1","block":"Base","phase":"Strength","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1},
          {"label":"Week 2","block":"Base","phase":"Strength","weekFrom":2,"weekTo":2,"pageFrom":2,"pageTo":2,"dayCount":1}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source() => new("background.pdf", 1,
        [new ImportPageText(1, "WEEK 1\nBarbell bench press 3 x 5-8 @ RPE 8")]);

    private static ImportSourceInput TwoPageSource() => new("background-two-page.pdf", 2,
        [new ImportPageText(1, "WEEK 1\nBarbell bench press 3 x 5-8 @ RPE 8"),
         new ImportPageText(2, "WEEK 2\nBarbell bench press 3 x 5-8 @ RPE 8")]);

    private static string DayForWeek(int week) => Day.Replace("\"weekNumber\":1", $"\"weekNumber\":{week}")
        .Replace("\"sourcePage\":1", $"\"sourcePage\":{week}");

    private static HttpResponseMessage Answer(string payload) => new(HttpStatusCode.OK)
    {
        Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(payload)}}}]}]}""")
    };

    [Fact]
    public async Task Runner_returns_control_immediately_and_coalesces_duplicate_kicks()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var handler = new BlockingHandler();
        var imports = h.Imports(handler);
        var pending = await imports.Create(Source(), default);
        var runner = h.Runner(handler);

        Assert.True(runner.Start(pending.Id, h.Db.CurrentUser!.Value));
        await handler.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(runner.WaitForIdle(pending.Id).IsCompleted);
        Assert.False(runner.Start(pending.Id, h.Db.CurrentUser!.Value));

        handler.Release.TrySetResult(null);
        await runner.WaitForIdle(pending.Id).WaitAsync(TimeSpan.FromSeconds(5));

        var ready = await imports.Get(pending.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, handler.Calls);
    }

    [Fact]
    public async Task Runner_records_a_provider_failure_and_a_later_kick_resumes_the_import()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var handler = new RetryableHandler();
        var imports = h.Imports(handler);
        var pending = await imports.Create(Source(), default);
        var runner = h.Runner(handler);

        Assert.True(runner.Start(pending.Id, h.Db.CurrentUser!.Value));
        await runner.WaitForIdle(pending.Id).WaitAsync(TimeSpan.FromSeconds(5));
        var failed = await imports.Get(pending.Id, default);
        Assert.Equal(ImportStatus.Pending, failed.Status);
        Assert.Equal("extract", failed.Stage);
        Assert.NotEmpty(failed.Error);

        handler.AllowSuccess = true;
        Assert.True(runner.Start(pending.Id, h.Db.CurrentUser!.Value));
        await runner.WaitForIdle(pending.Id).WaitAsync(TimeSpan.FromSeconds(5));

        var ready = await imports.Get(pending.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(3, handler.Calls);
    }

    [Fact]
    public async Task Runner_keeps_the_committed_prefix_when_a_later_section_fails()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var handler = new PrefixHandler();
        var imports = h.Imports(handler);
        var pending = await imports.Create(TwoPageSource(), default);
        var runner = h.Runner(handler);

        Assert.True(runner.Start(pending.Id, h.Db.CurrentUser!.Value));
        await runner.WaitForIdle(pending.Id).WaitAsync(TimeSpan.FromSeconds(5));
        var partial = await imports.Get(pending.Id, default);
        Assert.Equal(ImportStatus.Pending, partial.Status);
        Assert.Equal(1, partial.ChunksDone);
        Assert.Single(partial.Draft!.Workouts);
        Assert.NotEmpty(partial.Error);

        handler.AllowSecondSuccess = true;
        Assert.True(runner.Start(pending.Id, h.Db.CurrentUser!.Value));
        await runner.WaitForIdle(pending.Id).WaitAsync(TimeSpan.FromSeconds(5));

        var ready = await imports.Get(pending.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, ready.ChunksDone);
        Assert.Equal(2, ready.Draft!.Workouts.Count);
        Assert.Equal(4, handler.Calls);
    }

    private sealed class BlockingHandler : HttpMessageHandler
    {
        public TaskCompletionSource<object?> Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<object?> Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            if (Calls == 1) return Answer(Outline);
            Started.TrySetResult(null);
            await Release.Task.WaitAsync(ct);
            return Answer(Day);
        }
    }

    private sealed class RetryableHandler : HttpMessageHandler
    {
        public bool AllowSuccess { get; set; }
        public int Calls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            if (Calls == 1) return Answer(Outline);
            await Task.Yield();
            return AllowSuccess
                ? Answer(Day)
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"status\":\"incomplete\",\"output\":[]}") };
        }
    }

    private sealed class PrefixHandler : HttpMessageHandler
    {
        public bool AllowSecondSuccess { get; set; }
        public int Calls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            if (body.Contains("training_program_outline")) return Answer(TwoChunkOutline);
            if (body.Contains("absolute weeks 1-1")) return Answer(DayForWeek(1));
            return AllowSecondSuccess
                ? Answer(DayForWeek(2))
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"status\":\"incomplete\",\"output\":[]}") };
        }
    }
}
