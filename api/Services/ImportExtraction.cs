using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Resumable uploads and the AI reading pipeline.
///
/// Two rules shape this file. A model read can take minutes, so it never runs inside the per-user
/// mutation transaction: holding the advisory lock and an open transaction across it blocks every
/// other request from that account and loses the whole read if the connection drops. And a source
/// object is deleted only after the state that stopped referencing it is committed, because
/// deleting first leaves a committed key pointing at bytes that are gone — which every later read
/// reports as "The temporary PDF has expired" for an import that never actually expired.
public sealed partial class ImportService
{
    public const int DailyLimit = 150;
    private static readonly TimeSpan SourceRetention = TimeSpan.FromHours(24);

    /// Accepts the document and reads its outline. Uploading a PDF that already has an unfinished
    /// import is the recovery this app asks the user to perform, so it restores that import's
    /// source instead of handing back a row whose bytes are gone.
    public async Task<ImportView> Create(byte[] pdf, string fileName, CancellationToken ct)
    {
        ValidatePdf(pdf, fileName);
        var user = db.CurrentUser!.Value;
        var hash = Convert.ToHexString(SHA256.HashData(pdf));
        Guid importId;
        bool readOutline;
        int? nextChunk;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.FirstOrDefaultAsync(i => i.DocumentHash == hash && i.PromptVersion == WorkoutAi.PromptVersion
                && (i.Status == ImportStatus.Pending || i.Status == ImportStatus.Ready || i.Status == ImportStatus.Accepted), ct);
            if (import == null)
            {
                import = new AiImport
                {
                    UserId = user, DocumentHash = hash, PromptVersion = WorkoutAi.PromptVersion,
                    FileName = fileName.Trim(), Pages = PdfInspection.ApproximatePages(pdf),
                    Status = ImportStatus.Pending, Stage = "outline",
                    PageCoverageJson = Json.Write(PdfInspection.Coverage(pdf))
                };
                db.Imports.Add(import);
                await db.SaveChangesAsync(ct);
            }
            if (import.Status == ImportStatus.Pending && string.IsNullOrEmpty(import.SourceFileKey))
            {
                import.SourceFileKey = await files.Save(user, import.Id, pdf, ct);
                import.SourceFileExpiresAt = DateTime.UtcNow.Add(SourceRetention);
                import.Error = ""; import.Revision++;
            }
            readOutline = import.Status == ImportStatus.Pending && import.Stage == "outline";
            MarkDispatch(import);
            nextChunk = import.PendingDispatchChunk;
            importId = import.Id;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        db.ChangeTracker.Clear();
        if (readOutline) return await ReadOutline(importId, pdf, ct);
        await TryDispatch(user, importId, nextChunk, ct);
        return await Get(importId, ct);
    }

    /// One outline pass: the AI read runs between two short transactions so a slow model never
    /// holds the account lock, and a duplicate pass cannot overwrite an outline already applied.
    private async Task<ImportView> ReadOutline(Guid importId, byte[] pdf, CancellationToken ct)
    {
        var user = db.CurrentUser!.Value;
        string fileName;
        await using (var claim = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            Validation.Require(import!.Status == ImportStatus.Pending && import.Stage == "outline", "This import has already been read.", 409);
            await Meter(import, ct);
            fileName = import.FileName;
            await db.SaveChangesAsync(ct);
            await claim.Commit(ct);
        }
        db.ChangeTracker.Clear();

        AiOutlineResult result;
        try
        {
            result = await ai.Outline(pdf, fileName, [], AuthService.Hash(user.ToString())[..32], ct);
        }
        catch (DomainException ex)
        {
            await FailImport(importId, ex.Message);
            throw;
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            // A transport or provider fault is not the document's fault. The source is kept so the
            // same import can be read again instead of forcing another upload.
            await RecordRetryableFailure(importId, "Reading this PDF did not finish. Try again.", chunk: null);
            throw;
        }

        // The read is paid for and complete: commit it even if the browser has since disconnected.
        var settle = CancellationToken.None;
        string? release = null;
        int? nextChunk = null;
        DomainException? rejected = null;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, settle))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
            if (import is not null && import.Status == ImportStatus.Pending && import.Stage == "outline")
            {
                try
                {
                    await ApplyOutline(import, result, settle);
                    if (import.Status == ImportStatus.Ready) release = TakeSource(import);
                    MarkDispatch(import);
                    nextChunk = import.PendingDispatchChunk;
                    import.Revision++;
                    await db.SaveChangesAsync(settle);
                }
                catch (DomainException ex)
                {
                    // The account lock is not reentrant, so the outcome is recorded once this
                    // gate has closed rather than from inside it.
                    db.ChangeTracker.Clear();
                    release = null; nextChunk = null; rejected = ex;
                }
            }
            await gate.Commit(settle);
        }
        if (rejected is not null)
        {
            await FailImport(importId, rejected.Message);
            throw rejected;
        }
        await DeleteQuietly(release, settle);
        await TryDispatch(user, importId, nextChunk, ct);
        return await Get(importId, ct);
    }

    private async Task ApplyOutline(AiImport import, AiOutlineResult result, CancellationToken ct)
    {
        import.Model = result.Model; import.InputTokens += result.InputTokens; import.OutputTokens += result.OutputTokens;
        import.VisualFallbacks += result.VisualFallback ? 1 : 0; import.Error = "";
        if (result.LegacyProgram is { } legacy)
        {
            var draft = await ToDraft(legacy, ct);
            await ValidateDraft(draft, ct);
            ValidateDraftPages(draft, import.PageCoverageJson);
            import.DraftJson = Json.Write(draft); import.Stage = "done"; import.Status = ImportStatus.Ready;
            import.ChunksDone = 1; import.ChunksTotal = 1;
            UpdateCounters(import, draft);
            return;
        }
        // Exercise matching is local and happens after each chunk is parsed. The catalog is
        // deliberately absent from outline/extraction requests so a long library cannot consume
        // context tokens or bias the transcription toward a near match.
        var alternatives = result.Outline!.Alternatives ?? [];
        if (alternatives.Count > 1)
        {
            import.AlternativesJson = Json.Write(alternatives.Select(a => new ImportAlternative(a.Id, a.Name, a.Description,
                a.Chunks.Count, a.Chunks.Sum(c => c.DayCount), a.Chunks.Select(ToImportChunk).ToList())).ToList());
            import.Stage = "select"; import.Status = ImportStatus.Pending; import.ChunksDone = 0; import.ChunksTotal = 0;
            import.DraftJson = Json.Write(new ImportDraft(result.Outline.ProgramTitle, result.Outline.Description, []));
            return;
        }
        var selected = alternatives.Count == 1 ? alternatives[0] : null;
        var chunks = SplitChunks((selected?.Chunks ?? result.Outline.Chunks).Select(c => c with { }).ToList());
        ValidateChunkPages(chunks, import.PageCoverageJson);
        import.SelectedAlternativeId = selected?.Id ?? "";
        import.OutlineJson = Json.Write(chunks);
        import.DraftJson = Json.Write(new ImportDraft(selected?.Name ?? result.Outline.ProgramTitle, selected?.Description ?? result.Outline.Description, []));
        import.Stage = "extract"; import.Status = ImportStatus.Pending; import.ChunksDone = 0; import.ChunksTotal = chunks.Count;
        import.UnresolvedCount = 0; import.CatalogStale = false;
    }

    public async Task<ImportView> SelectAlternative(Guid id, string alternativeId, CancellationToken ct)
    {
        var user = db.CurrentUser!.Value;
        int? nextChunk;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            Validation.Require(import!.Status == ImportStatus.Pending && import.Stage == "select", "This import is not waiting for an alternative selection.", 409);
            var alternatives = string.IsNullOrWhiteSpace(import.AlternativesJson) ? [] : Json.Read<List<ImportAlternative>>(import.AlternativesJson);
            var selected = alternatives.SingleOrDefault(a => string.Equals(a.Id, alternativeId, StringComparison.OrdinalIgnoreCase));
            Validation.Require(selected is not null, "That alternative is no longer available. Read the outline again.", 409);
            var chunks = SplitChunks(selected!.Chunks ?? []);
            ValidateChunkPages(chunks, import.PageCoverageJson);
            import.SelectedAlternativeId = selected.Id; import.OutlineJson = Json.Write(chunks);
            import.DraftJson = Json.Write(new ImportDraft(selected.Name, selected.Description, []));
            import.Stage = "extract"; import.ChunksDone = 0; import.ChunksTotal = chunks.Count; import.Revision++;
            MarkDispatch(import);
            nextChunk = import.PendingDispatchChunk;
            await db.SaveChangesAsync(ct); await gate.Commit(ct);
        }
        db.ChangeTracker.Clear();
        await TryDispatch(user, id, nextChunk, ct);
        return await Get(id, ct);
    }

    private static ImportChunk ToImportChunk(AiOutlineChunk chunk)
        => new(chunk.Label, chunk.Block, chunk.Phase, chunk.WeekFrom, chunk.WeekTo, chunk.PageFrom, chunk.PageTo, chunk.DayCount);

    /// One extraction chunk. An empty <paramref name="pdf"/> reads the stored source; supplying the
    /// bytes restores a source that was lost so the remaining chunks no longer need the browser.
    public async Task<ImportView> Extract(Guid id, byte[] pdf, string fileName, CancellationToken ct, int? expectedChunk = null)
    {
        var user = db.CurrentUser!.Value;
        ImportChunk chunk = default!;
        var chunkIndex = 0;
        byte[] source = [];
        var sourceName = "";
        byte[]? outlineSource = null;
        await using (var claim = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            // A duplicate delivery after the last chunk committed is already complete and is safe
            // to acknowledge without asking the model to read the document again.
            if (import!.Status == ImportStatus.Ready && import.Stage == "done")
            {
                await claim.Commit(ct);
                return await Get(id, ct);
            }
            // An outline that never landed is resumable from the same stored source, so a retry
            // continues the import rather than reporting a stage it can never leave. The account
            // lock is not reentrant, so that pass starts after this gate closes.
            if (import.Status == ImportStatus.Pending && import.Stage == "outline")
            {
                outlineSource = await SourceBytes(import, pdf, fileName, ct);
                await db.SaveChangesAsync(ct);
                await claim.Commit(ct);
            }
            else
            {
                Validation.Require(import.Status == ImportStatus.Pending && import.Stage == "extract", "This import is not waiting for another extraction pass.", 409);
                if (expectedChunk is { } expected)
                {
                    // A stale duplicate is acknowledged after a later chunk has committed. A future
                    // task cannot advance the import out of order and is retried after its predecessor.
                    if (import.ChunksDone > expected)
                    {
                        await claim.Commit(ct);
                        return await Get(id, ct);
                    }
                    Validation.Require(import.ChunksDone == expected, "This extraction chunk is not ready yet; retry after the previous chunk commits.", 409);
                }
                source = await SourceBytes(import, pdf, fileName, ct);
                sourceName = import.FileName;
                var chunks = ReadChunks(import.OutlineJson);
                Validation.Require(import.ChunksDone < chunks.Count, "This import has already finished extracting.", 409);
                chunkIndex = import.ChunksDone;
                chunk = chunks[chunkIndex];
                ValidateChunkPages([chunk], import.PageCoverageJson);
                await Meter(import, ct);
                await db.SaveChangesAsync(ct);
                await claim.Commit(ct);
            }
        }
        db.ChangeTracker.Clear();
        if (outlineSource is not null) return await ReadOutline(id, outlineSource, ct);

        AiImportResult result;
        try
        {
            result = await ai.ExtractChunk(source, sourceName, [], AuthService.Hash(user.ToString())[..32],
                $"Extract only chunk '{chunk.Label}', covering block '{chunk.Block}', phase '{chunk.Phase}', absolute weeks {chunk.WeekFrom}-{chunk.WeekTo}, pages {chunk.PageFrom}-{chunk.PageTo}. Return those days and no days from other chunks.",
                ct, chunk.PageFrom, chunk.PageTo);
        }
        catch (DomainException ex)
        {
            await RecordRetryableFailure(id, ex.Message, chunkIndex);
            throw;
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            await RecordRetryableFailure(id, "That extraction chunk did not finish. Try again.", chunkIndex);
            throw;
        }

        var settle = CancellationToken.None;
        string? release = null;
        int? nextChunk = null;
        DomainException? rejected = null;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, settle))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, settle);
            // Another delivery may have committed this same chunk while the model was reading.
            // The duplicate result is dropped instead of being merged a second time.
            if (import is not null && import.Status == ImportStatus.Pending && import.Stage == "extract" && import.ChunksDone == chunkIndex)
            {
                var existing = Json.Read<ImportDraft>(import.DraftJson);
                var complete = chunkIndex + 1 >= import.ChunksTotal;
                try
                {
                    // Everything that can reject this result runs before the row is touched, so a
                    // rejected chunk stays retryable instead of committing a half-applied import.
                    var extracted = await ToDraft(result.Program, settle);
                    ValidateChunkCoverage(existing, extracted, chunk);
                    var merged = existing with
                    {
                        ProgramName = result.Program.ProgramTitle ?? result.Program.ProgramName ?? existing.ProgramName,
                        Description = result.Program.Description ?? existing.Description,
                        Workouts = [.. existing.Workouts, .. extracted.Workouts]
                    };
                    if (complete)
                    {
                        await ValidateDraft(merged, settle);
                        ValidateDraftPages(merged, import.PageCoverageJson);
                    }
                    import.DraftJson = Json.Write(merged); import.ChunksDone = chunkIndex + 1; import.Revision++; import.Model = result.Model;
                    import.InputTokens += result.InputTokens; import.OutputTokens += result.OutputTokens;
                    import.VisualFallbacks += result.VisualFallback ? 1 : 0; import.Error = "";
                    if (complete)
                    {
                        import.Status = ImportStatus.Ready; import.Stage = "done"; UpdateCounters(import, merged);
                        release = TakeSource(import);
                    }
                    MarkDispatch(import);
                    nextChunk = import.PendingDispatchChunk;
                    await db.SaveChangesAsync(settle);
                }
                catch (DomainException ex)
                {
                    db.ChangeTracker.Clear();
                    release = null; nextChunk = null; rejected = ex;
                }
            }
            await gate.Commit(settle);
        }
        if (rejected is not null)
        {
            await RecordRetryableFailure(id, rejected.Message, chunkIndex);
            throw rejected;
        }
        await DeleteQuietly(release, settle);
        await TryDispatch(user, id, nextChunk, ct);
        return await Get(id, ct);
    }

    /// Retry is an explicit idempotent operation for a pending import. The persisted source is
    /// reused while it is inside its retention window; callers can supply the PDF through the
    /// extract endpoint once that source is gone.
    public Task<ImportView> Retry(Guid id, CancellationToken ct) => Extract(id, [], "", ct);

    /// Resolves the bytes this pass will read and keeps a caller-supplied document as the stored
    /// source, so restoring a lost source only has to happen once.
    private async Task<byte[]> SourceBytes(AiImport import, byte[] pdf, string fileName, CancellationToken ct)
    {
        if (pdf.Length == 0)
        {
            Validation.Require(!string.IsNullOrWhiteSpace(import.SourceFileKey), "The temporary PDF has expired. Upload it again.", 410);
            pdf = await files.Read(import.SourceFileKey, ct);
            fileName = import.FileName;
        }
        ValidatePdf(pdf, fileName);
        Validation.Require(Convert.ToHexString(SHA256.HashData(pdf)) == import.DocumentHash,
            "Choose the same PDF that started this import so the next chunk can be verified.", 409);
        if (string.IsNullOrEmpty(import.SourceFileKey))
        {
            import.SourceFileKey = await files.Save(import.UserId, import.Id, pdf, ct);
            import.SourceFileExpiresAt = DateTime.UtcNow.Add(SourceRetention);
            import.Revision++;
        }
        return pdf;
    }

    private static string TakeSource(AiImport import)
    {
        var key = import.SourceFileKey;
        import.SourceFileKey = ""; import.SourceFileExpiresAt = null;
        return key;
    }

    /// Storage deletion is best effort and always follows the commit that released the key. A
    /// failed delete leaves an orphan the bucket lifecycle reclaims; failing the request instead
    /// would report an error for an import that succeeded.
    private async Task DeleteQuietly(string? key, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(key)) return;
        try { await files.Delete(key, ct); }
        catch (DomainException) { }
        catch (IOException) { }
        catch (HttpRequestException) { }
        catch (Google.GoogleApiException) { }
    }

    private async Task FailImport(Guid importId, string message)
    {
        var settle = CancellationToken.None;
        db.ChangeTracker.Clear();
        string? release;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, settle))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
            if (import is null || import.Status != ImportStatus.Pending) { await gate.Commit(settle); return; }
            // A failed import leaves nothing worth keeping. The reason travels back in the response
            // that reports it, so the row is removed instead of lingering in the list forever.
            release = TakeSource(import);
            db.Imports.Remove(import);
            await db.SaveChangesAsync(settle);
            await gate.Commit(settle);
        }
        await DeleteQuietly(release, settle);
    }

    /// Records a failure the same import can still recover from and re-arms durable delivery, so a
    /// browser that gave up does not strand work a worker could finish.
    private async Task RecordRetryableFailure(Guid importId, string message, int? chunk)
    {
        var settle = CancellationToken.None;
        db.ChangeTracker.Clear();
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, settle);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
        if (import is null || import.Status != ImportStatus.Pending) { await gate.Commit(settle); return; }
        import.Error = message; import.Retries++; import.Revision++;
        if (!string.IsNullOrEmpty(import.SourceFileKey))
        {
            import.PendingDispatchChunk = chunk ?? import.ChunksDone;
            import.PendingDispatchAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(settle);
        await gate.Commit(settle);
    }
}
