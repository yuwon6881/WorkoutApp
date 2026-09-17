using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Durable resumable uploads. A PDF is assembled server-side before it becomes an import, so a
/// dropped connection resumes at the next chunk instead of restarting a 150 MiB transfer.
public sealed partial class ImportService
{
    /// The browser reaches this API through the Vercel rewrite in `web/vercel.json`, and that proxy
    /// rejects or stalls a request body over roughly 4.5 MB. Chunks stay well under it: a 4 MiB
    /// chunk sat on the limit once headers were counted and hung mid-upload instead of failing.
    public const int UploadChunkBytes = 2 * 1024 * 1024;

    public async Task<ImportUploadView> InitiateUpload(string fileName, long expectedBytes, CancellationToken ct)
    {
        Validation.Require(expectedBytes is > 0 and <= PdfInspection.MaxBytes, "That PDF must be between 1 byte and 150 MiB.", 413);
        Validation.Name(fileName, "File name", 200);
        Validation.Require(fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), "Choose a PDF file.");
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var upload = new ImportUpload { UserId = db.CurrentUser!.Value, FileName = fileName.Trim(), ExpectedBytes = expectedBytes };
        db.ImportUploads.Add(upload);
        upload.SourceFileKey = await files.StartUpload(upload.UserId, upload.Id, upload.ExpectedBytes, ct);
        await db.SaveChangesAsync(ct); await gate.Commit(ct);
        return ToUploadView(upload);
    }

    public async Task<ImportUploadView> AppendUpload(Guid id, long offset, byte[] bytes, CancellationToken ct)
    {
        Validation.Require(bytes.Length > 0 && bytes.Length <= UploadChunkBytes, $"Upload chunks must be between 1 and {UploadChunkBytes / (1024 * 1024)} MiB.", 413);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var upload = await db.ImportUploads.SingleOrDefaultAsync(x => x.Id == id, ct);
        Validation.Require(upload != null, "That upload session has expired. Start the upload again.", 404);
        Validation.Require(upload!.Status == "open" && upload.ExpiresAt > DateTime.UtcNow, "That upload session has expired. Start the upload again.", 410);
        Validation.Require(offset == upload.ReceivedBytes, "The upload offset is stale; refresh the upload and retry the next chunk.", 409);
        Validation.Require(upload.ReceivedBytes + bytes.Length <= upload.ExpectedBytes, "That chunk is larger than the remaining upload.", 413);
        // Storage decides how much it kept, so the session resumes from its number rather than
        // from what was sent. A chunk it did not commit is simply re-sent by the client.
        var committed = await files.Append(upload.SourceFileKey, offset, bytes, upload.ExpectedBytes, ct);
        Validation.Require(committed > upload.ReceivedBytes,
            "The cloud storage did not keep that chunk. Retry the same chunk.", 503);
        upload.ReceivedBytes = Math.Min(committed, upload.ExpectedBytes); upload.Revision++;
        await db.SaveChangesAsync(ct); await gate.Commit(ct);
        return ToUploadView(upload);
    }

    public async Task<ImportView> CompleteUpload(Guid id, CancellationToken ct)
    {
        byte[] pdf;
        string fileName;
        string sourceKey;
        long expectedBytes;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var upload = await db.ImportUploads.SingleOrDefaultAsync(x => x.Id == id, ct);
            Validation.Require(upload != null, "That upload session has expired. Start the upload again.", 404);
            Validation.Require(upload!.Status == "open" && upload.ExpiresAt > DateTime.UtcNow, "That upload session has expired. Start the upload again.", 410);
            Validation.Require(upload.ReceivedBytes == upload.ExpectedBytes, "The PDF upload is not complete yet.", 409);
            upload.Status = "processing"; upload.Revision++;
            pdf = await files.Read(upload.SourceFileKey, ct); fileName = upload.FileName; sourceKey = upload.SourceFileKey; expectedBytes = upload.ExpectedBytes;
            await db.SaveChangesAsync(ct); await gate.Commit(ct);
        }
        try
        {
            Validation.Require(pdf.LongLength == expectedBytes, "The uploaded PDF size does not match the resumable upload.", 422);
            // Create validates the complete object and stores its own transient source for any
            // background extraction continuation. The resumable part is removed afterwards.
            // Once the upload has been committed, let outline processing finish even if the
            // browser closes. Extraction chunks are persisted separately and can be resumed by
            // the worker, so a disconnected response must not roll the import back.
            var processingCt = CancellationToken.None;
            var result = await Create(pdf, fileName, processingCt);
            db.ChangeTracker.Clear();
            await using (var cleanupGate = await MutationLock.Acquire(db, db.CurrentUser, processingCt))
            {
                var row = await db.ImportUploads.SingleOrDefaultAsync(x => x.Id == id, processingCt);
                if (row is not null) db.ImportUploads.Remove(row);
                await db.SaveChangesAsync(processingCt); await cleanupGate.Commit(processingCt);
            }
            await DeleteQuietly(sourceKey, processingCt);
            return result;
        }
        catch
        {
            // Restore the resumable session even when the request was cancelled. The original
            // exception remains authoritative; the 24-hour expiry is the cleanup backstop.
            db.ChangeTracker.Clear();
            await using var retryGate = await MutationLock.Acquire(db, db.CurrentUser, CancellationToken.None);
            var row = await db.ImportUploads.SingleOrDefaultAsync(x => x.Id == id, CancellationToken.None);
            if (row is not null && row.ExpiresAt > DateTime.UtcNow)
            {
                row.Status = "open"; row.Revision++;
                await db.SaveChangesAsync(CancellationToken.None); await retryGate.Commit(CancellationToken.None);
            }
            throw;
        }
    }

    public async Task CancelUpload(Guid id, CancellationToken ct)
    {
        string key;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var upload = await db.ImportUploads.SingleOrDefaultAsync(x => x.Id == id, ct);
            Validation.Require(upload != null, "That upload session has expired. Start the upload again.", 404);
            Validation.Require(upload!.Status == "open", "This upload is already being processed and cannot be cancelled.", 409);
            key = upload.SourceFileKey;
            db.ImportUploads.Remove(upload);
            await db.SaveChangesAsync(ct); await gate.Commit(ct);
        }
        await DeleteQuietly(key, ct);
    }

    private static ImportUploadView ToUploadView(ImportUpload upload)
        => new(upload.Id, upload.FileName, upload.ExpectedBytes, upload.ReceivedBytes, UploadChunkBytes, upload.Status, upload.ExpiresAt);
}
