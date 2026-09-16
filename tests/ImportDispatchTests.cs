using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportDispatchTests
{
    private const string Outline = """
        {"programTitle":"Dispatch block","description":null,"chunks":[
          {"label":"Week 1","block":"Base","phase":"Strength","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private const string Chunk = """
        {"programTitle":"Dispatch block","description":null,"days":[
          {"block":"Base","phase":"Strength","weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
        """;

    private static Dictionary<string, string?> Configured => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static byte[] Pdf()
        => Encoding.Latin1.GetBytes("%PDF-1.7\n/Type /Page\n%%EOF");

    [Fact]
    public async Task Failed_enqueue_remains_durable_for_hourly_recovery()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var dispatcher = new RecordingDispatcher(false);
        var calls = 0;
        var ai = new StubHandler(_ =>
        {
            var body = calls++ == 0 ? Outline : Chunk;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(body)}}}]}]}""")
            };
        });
        var imports = h.Imports(ai, dispatcher);

        var pending = await imports.Create(Pdf(), "dispatch.pdf", default);
        var row = await h.Db.Imports.AsNoTracking().SingleAsync();
        Assert.Equal(ImportStatus.Pending, pending.Status);
        Assert.Equal(0, row.PendingDispatchChunk);
        Assert.NotNull(row.PendingDispatchAt);
        Assert.Single(dispatcher.Deliveries);

        h.Db.CurrentUser = row.UserId;
        var tracked = await h.Db.Imports.SingleAsync();
        tracked.PendingDispatchAt = DateTime.UtcNow.AddMinutes(-1);
        await h.Db.SaveChangesAsync();
        dispatcher.Result = true;
        var recovered = await imports.RecoverUndispatched(default);

        Assert.Equal(1, recovered);
        Assert.Equal(0, dispatcher.Deliveries[^1].ExpectedChunk);
        Assert.True((await h.Db.Imports.AsNoTracking().SingleAsync()).PendingDispatchAt > DateTime.UtcNow);
    }

    [Fact]
    public async Task A_task_for_a_future_chunk_cannot_advance_the_import()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var calls = 0;
        var ai = new StubHandler(_ =>
        {
            var body = calls++ == 0 ? Outline : Chunk;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(body)}}}]}]}""")
            };
        });
        var imports = h.Imports(ai, new RecordingDispatcher(false));
        var pending = await imports.Create(Pdf(), "future.pdf", default);

        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Extract(pending.Id, [], "", default, expectedChunk: 1));

        Assert.Equal(409, failure.Status);
        Assert.Equal(1, ai.Calls);
    }

    [Fact]
    public async Task Maintenance_recovers_an_extract_created_before_dispatch_markers_existed()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var ai = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(Outline)}}}]}]}""")
        });
        var dispatcher = new RecordingDispatcher(false);
        var imports = h.Imports(ai, dispatcher);
        var pending = await imports.Create(Pdf(), "legacy.pdf", default);

        var row = await h.Db.Imports.SingleAsync(i => i.Id == pending.Id);
        row.PendingDispatchChunk = null;
        row.PendingDispatchAt = null;
        await h.Db.SaveChangesAsync();
        dispatcher.Result = true;

        var recovered = await imports.RecoverUndispatched(default);

        Assert.Equal(1, recovered);
        Assert.Equal(0, dispatcher.Deliveries[^1].ExpectedChunk);
        Assert.NotNull((await h.Db.Imports.AsNoTracking().SingleAsync()).PendingDispatchAt);
    }

    [Fact]
    public async Task A_duplicate_task_after_completion_is_acknowledged_without_another_ai_call()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var calls = 0;
        var ai = new StubHandler(_ =>
        {
            var body = calls++ == 0 ? Outline : Chunk;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(body)}}}]}]}""")
            };
        });
        var imports = h.Imports(ai, new RecordingDispatcher(false));
        var pending = await imports.Create(Pdf(), "duplicate.pdf", default);
        var ready = await imports.Extract(pending.Id, [], "", default, expectedChunk: 0);
        var duplicate = await imports.Extract(pending.Id, [], "", default, expectedChunk: 0);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(ImportStatus.Ready, duplicate.Status);
        Assert.Equal(2, ai.Calls);
        var row = await h.Db.Imports.AsNoTracking().SingleAsync();
        Assert.Null(row.PendingDispatchChunk);
        Assert.Null(row.PendingDispatchAt);
    }

    private sealed class RecordingDispatcher(bool result) : IImportJobDispatcher
    {
        public bool Result { get; set; } = result;
        public List<(Guid UserId, Guid ImportId, int ExpectedChunk)> Deliveries { get; } = [];

        public Task<bool> Enqueue(Guid userId, Guid importId, int expectedChunk, CancellationToken ct)
        {
            Deliveries.Add((userId, importId, expectedChunk));
            return Task.FromResult(Result);
        }
    }
}
