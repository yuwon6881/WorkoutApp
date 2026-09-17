using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// An import that loses its stored PDF used to be a dead end: every later read answered "The
/// temporary PDF has expired. Upload it again.", and uploading it again returned the same dead row.
public sealed class ImportRecoveryTests
{
    private const string Outline = """
        {"programTitle":"Recovery","description":null,"chunks":[
          {"label":"Week 1","block":"Base","phase":"Strength","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private const string Chunk = """
        {"programTitle":"Recovery","description":null,"days":[
          {"block":"Base","phase":"Strength","weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini",
        ["ImportStorage:Directory"] = Path.Combine(Path.GetTempPath(), "workout-import-tests", Guid.NewGuid().ToString("N"))
    };

    private static byte[] Pdf() => Encoding.Latin1.GetBytes("%PDF-1.7\n/Type /Page\n%%EOF");

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
    public async Task Uploading_the_same_pdf_again_restores_a_lost_source()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var imports = h.Imports(Reading(Outline, Chunk));
        var pending = await imports.Create(Pdf(), "recovery.pdf", default);
        Assert.Equal("extract", pending.Stage);

        var row = await h.Db.Imports.SingleAsync();
        row.SourceFileKey = "";
        row.SourceFileExpiresAt = null;
        await h.Db.SaveChangesAsync();
        h.Db.ChangeTracker.Clear();

        var gone = await Assert.ThrowsAsync<DomainException>(() => imports.Extract(pending.Id, [], "", default));
        Assert.Equal(410, gone.Status);

        var again = await imports.Create(Pdf(), "recovery.pdf", default);

        Assert.Equal(pending.Id, again.Id);
        Assert.NotNull(again.SourceFileExpiresAt);
        var resumed = await imports.Extract(again.Id, [], "", default);
        Assert.Equal(ImportStatus.Ready, resumed.Status);
    }

    [Fact]
    public async Task Supplying_the_pdf_to_a_chunk_restores_the_stored_source()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var imports = h.Imports(Reading(Outline, Chunk));
        var pending = await imports.Create(Pdf(), "restore.pdf", default);
        var row = await h.Db.Imports.SingleAsync();
        row.SourceFileKey = "";
        row.SourceFileExpiresAt = null;
        await h.Db.SaveChangesAsync();
        h.Db.ChangeTracker.Clear();

        var ready = await imports.Extract(pending.Id, Pdf(), "restore.pdf", default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
    }

    [Fact]
    public async Task An_outline_that_never_landed_is_retryable_from_the_stored_source()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var failing = h.Imports(new StubHandler(_ => throw new HttpRequestException("provider unreachable")));

        await Assert.ThrowsAsync<HttpRequestException>(() => failing.Create(Pdf(), "outline.pdf", default));

        var row = await h.Db.Imports.AsNoTracking().SingleAsync();
        Assert.Equal(ImportStatus.Pending, row.Status);
        Assert.Equal("outline", row.Stage);
        Assert.NotEqual("", row.SourceFileKey);
        Assert.NotEqual("", row.Error);

        h.Db.ChangeTracker.Clear();
        var imports = h.Imports(Reading(Outline, Chunk));
        var resumed = await imports.Retry(row.Id, default);

        Assert.Equal("extract", resumed.Stage);
        Assert.Equal(ImportStatus.Ready, (await imports.Retry(row.Id, default)).Status);
    }

    [Fact]
    public async Task A_rejected_final_chunk_leaves_the_import_retryable()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        // A day with no exercises fails draft validation on the last chunk.
        const string Empty = """
            {"programTitle":"Recovery","description":null,"days":[
              {"block":"Base","phase":"Strength","weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[]}]}
            """;
        var imports = h.Imports(Reading(Outline, Empty, Chunk));
        var pending = await imports.Create(Pdf(), "rejected.pdf", default);

        await Assert.ThrowsAsync<DomainException>(() => imports.Extract(pending.Id, [], "", default));

        var row = await h.Db.Imports.AsNoTracking().SingleAsync();
        Assert.Equal(ImportStatus.Pending, row.Status);
        Assert.Equal(0, row.ChunksDone);
        Assert.NotEqual("", row.SourceFileKey);

        h.Db.ChangeTracker.Clear();
        Assert.Equal(ImportStatus.Ready, (await imports.Retry(pending.Id, default)).Status);
    }

    [Fact]
    public async Task A_completed_import_keeps_its_source_until_the_commit_lands()
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var store = new FailingDeleteStore(new TransientImportFileStore(h.Config));
        var imports = new ImportService(h.Db, new WorkoutAi(new HttpClient(Reading(Outline, Chunk)), h.Config),
            h.Catalog, h.Programs, store, null, h.Config);

        var pending = await imports.Create(Pdf(), "keep.pdf", default);
        var ready = await imports.Extract(pending.Id, [], "", default);

        // Storage refused the delete; the import is still complete and its key already released.
        Assert.Equal(ImportStatus.Ready, ready.Status);
        var row = await h.Db.Imports.AsNoTracking().SingleAsync();
        Assert.Equal("", row.SourceFileKey);
        Assert.Null(row.SourceFileExpiresAt);
    }

    private sealed class FailingDeleteStore(IImportFileStore inner) : IImportFileStore
    {
        public Task<string> Save(Guid userId, Guid importId, byte[] bytes, CancellationToken ct) => inner.Save(userId, importId, bytes, ct);
        public Task<string> StartUpload(Guid userId, Guid uploadId, long expectedBytes, CancellationToken ct) => inner.StartUpload(userId, uploadId, expectedBytes, ct);
        public Task<long> Append(string key, long offset, byte[] bytes, long totalBytes, CancellationToken ct) => inner.Append(key, offset, bytes, totalBytes, ct);
        public Task<byte[]> Read(string key, CancellationToken ct) => inner.Read(key, ct);
        public Task Delete(string? key, CancellationToken ct) => throw new IOException("storage unavailable");
    }
}
