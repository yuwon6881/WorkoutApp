using System.Text;
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
