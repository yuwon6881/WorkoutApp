using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A resumable upload that never finished storing must say so. Reporting it as an expired import
/// source sends the user to re-upload a PDF the importer never accepted, which is the same message
/// they would see for a genuinely expired source and tells them nothing useful.
public sealed class ImportUploadTests
{
    private static TransientImportFileStore Store()
        => new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ImportStorage:Directory"] = Path.Combine(Path.GetTempPath(), "workout-upload-tests", Guid.NewGuid().ToString("N"))
        }).Build());

    [Fact]
    public async Task A_missing_resumable_part_asks_for_the_upload_again_not_the_pdf()
    {
        var store = Store();
        var user = Guid.NewGuid();
        var key = await store.StartUpload(user, Guid.NewGuid(), 16, default);
        await store.Delete(key, default);

        var failure = await Assert.ThrowsAsync<DomainException>(() => store.Read(key, default));

        Assert.Equal(410, failure.Status);
        Assert.Contains("Start the upload again", failure.Message);
        Assert.DoesNotContain("temporary PDF has expired", failure.Message);
    }

    [Fact]
    public async Task A_missing_import_source_still_asks_for_the_pdf()
    {
        var store = Store();
        var user = Guid.NewGuid();
        var key = await store.Save(user, Guid.NewGuid(), Encoding.Latin1.GetBytes("%PDF-1.7\n%%EOF"), default);
        await store.Delete(key, default);

        var failure = await Assert.ThrowsAsync<DomainException>(() => store.Read(key, default));

        Assert.Equal(410, failure.Status);
        Assert.Contains("temporary PDF has expired", failure.Message);
    }

    [Fact]
    public async Task A_session_resumes_from_what_storage_kept_not_from_what_was_sent()
    {
        await using var h = await Harness.Create(new Dictionary<string, string?>
        {
            ["OpenAi:ApiKey"] = "test-key",
            ["OpenAi:Model"] = "gpt-5.4-mini"
        });
        await h.SignIn();
        var payload = Encoding.Latin1.GetBytes("%PDF-1.7\n/Type /Page\n" + new string('x', 400) + "\n%%EOF");
        // Storage keeps only half of every chunk it is handed, exactly as a resumable backend may.
        var store = new HalfCommittingStore(Store());
        var imports = new ImportService(h.Db, new WorkoutAi(new HttpClient(new StubHandler(_ => throw new HttpRequestException("unused"))), h.Config),
            h.Catalog, h.Programs, store, null, h.Config);

        var upload = await imports.InitiateUpload("drift.pdf", payload.Length, default);
        var offset = 0L;
        var passes = 0;
        while (offset < payload.Length && passes++ < 50)
        {
            var end = (int)Math.Min(payload.Length, offset + 64);
            var view = await imports.AppendUpload(upload.Id, offset, payload[(int)offset..end], default);
            Assert.True(view.ReceivedBytes > offset, "The session has to advance by what storage committed.");
            offset = view.ReceivedBytes;
        }

        Assert.Equal(payload.Length, offset);
        Assert.Equal(payload, await store.Read(await KeyOf(h, upload.Id), default));
    }

    private static async Task<string> KeyOf(Harness h, Guid uploadId)
        => (await h.Db.ImportUploads.AsNoTracking().SingleAsync(x => x.Id == uploadId)).SourceFileKey;

    /// Commits half of each chunk, so a caller that assumes the whole chunk landed drifts past the
    /// real offset and can never finish.
    private sealed class HalfCommittingStore(TransientImportFileStore inner) : IImportFileStore
    {
        public Task<string> Save(Guid userId, Guid importId, byte[] bytes, CancellationToken ct) => inner.Save(userId, importId, bytes, ct);
        public Task<string> StartUpload(Guid userId, Guid uploadId, long expectedBytes, CancellationToken ct) => inner.StartUpload(userId, uploadId, expectedBytes, ct);
        public Task<byte[]> Read(string key, CancellationToken ct) => inner.Read(key, ct);
        public Task Delete(string? key, CancellationToken ct) => inner.Delete(key, ct);

        public Task<long> Append(string key, long offset, byte[] bytes, long totalBytes, CancellationToken ct)
        {
            var kept = Math.Max(1, bytes.Length / 2);
            return inner.Append(key, offset, bytes[..kept], totalBytes, ct);
        }
    }

    [Fact]
    public async Task A_completed_part_reads_back_the_bytes_that_were_appended()
    {
        var store = Store();
        var user = Guid.NewGuid();
        var payload = Encoding.Latin1.GetBytes("%PDF-1.7\n/Type /Page\n%%EOF");
        var key = await store.StartUpload(user, Guid.NewGuid(), payload.Length, default);
        var split = payload.Length / 2;
        await store.Append(key, 0, payload[..split], payload.Length, default);
        await store.Append(key, split, payload[split..], payload.Length, default);

        Assert.Equal(payload, await store.Read(key, default));
    }
}
