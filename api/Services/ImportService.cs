using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record ImportChunk(string Label, string? Block, string? Phase, int WeekFrom, int WeekTo, int PageFrom, int PageTo, int DayCount);
public record DraftSet(
    int RepMin, int RepMax, double? TargetRpe, int? RestSeconds, string? Tempo, string? LoadText, string? Notes,
    string RepsSource = "extracted", string RpeSource = "extracted", string RestSource = "extracted",
    string? RepsText = null, string? RestText = null, string? Percent1Rm = null, string? Rir = null, bool Warmup = false, int? SourcePage = null);
public record DraftExercise(Guid LineId, string SourceName, Guid? ExerciseId, string? Notes, List<DraftSet> Sets,
    string SequenceGroup = "", List<string>? Substitutions = null, int? SourcePage = null);
public record DraftWorkout(Guid LineId, int Week, string Name, string? Focus, string? Notes, List<DraftExercise> Exercises,
    string? Block = null, string? Phase = null, int PhaseWeek = 1, bool IsRestDay = false, int? Weekday = null, int? SourcePage = null);
public record ImportDraft(string ProgramName, string? Description, List<DraftWorkout> Workouts);
public record ImportMetadata(string ProgramName, string? Description);
public record UnresolvedExercise(Guid LineId, string SourceName);
public record ImportReviewIssue(string Code, string Message, string Severity = "warning", int? SourcePage = null);
public record ImportAlternative(string Id, string Name, string? Description, int ChunkCount, int DayCount, List<ImportChunk>? Chunks = null);
public record ImportUploadView(Guid Id, string FileName, long ExpectedBytes, long ReceivedBytes, int ChunkBytes, string Status, DateTime ExpiresAt);
public record ImportView(Guid Id, string Status, string FileName, int Pages, string Error, DateTime Created, string Model,
    string Stage, int ChunksDone, int ChunksTotal, string? CurrentChunkLabel, int UnresolvedCount, ImportDraft? Draft,
    List<UnresolvedExercise> Unresolved, bool Acceptable, Guid? ProgramId, List<ImportReviewIssue>? ReviewIssues = null,
    long InputTokens = 0, long OutputTokens = 0, int Retries = 0, int VisualFallbacks = 0, DateTime? SourceFileExpiresAt = null,
    List<PdfPageCoverage>? PageCoverage = null, List<ImportAlternative>? Alternatives = null, string? SelectedAlternativeId = null);

public sealed class ImportService(AppDb db, WorkoutAi ai, CatalogService catalog, ProgramService programs, IImportFileStore files, IImportJobDispatcher? jobs = null)
{
    // The original public constructor remains available to direct callers while the app container
    // supplies the configured GCS or transient store through the primary constructor.
    public ImportService(AppDb db, WorkoutAi ai, CatalogService catalog, ProgramService programs)
        : this(db, ai, catalog, programs, new TransientImportFileStore(new ConfigurationBuilder().Build()))
    {
    }

    public const int DailyLimit = 150;
    public const int UploadChunkBytes = 4 * 1024 * 1024;

    public async Task<List<ImportView>> List(CancellationToken ct)
    {
        var rows = await db.Imports.AsNoTracking().Where(i => i.Status != ImportStatus.Discarded)
            .OrderByDescending(i => i.Created).Take(50).ToListAsync(ct);
        var views = new List<ImportView>();
        foreach (var row in rows) views.Add(await View(row, includeDraft: false, ct));
        return views;
    }

    public async Task<ImportView> Get(Guid id, CancellationToken ct)
    {
        var import = await db.Imports.AsNoTracking().SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        return await View(import!, includeDraft: true, ct);
    }

    private async Task<ImportView> View(AiImport import, bool includeDraft, CancellationToken ct)
    {
        ImportDraft? draft = null;
        var unresolved = new List<UnresolvedExercise>();
        if (includeDraft && !string.IsNullOrEmpty(import.DraftJson))
        {
            draft = Json.Read<ImportDraft>(import.DraftJson);
            unresolved = Unresolved(draft);
        }
        var chunks = ReadChunks(import.OutlineJson);
        var unresolvedCount = includeDraft ? unresolved.Count : import.UnresolvedCount;
        var issues = includeDraft && draft is not null ? ReviewIssues(draft) : [];
        var coverage = string.IsNullOrWhiteSpace(import.PageCoverageJson) ? [] : Json.Read<List<PdfPageCoverage>>(import.PageCoverageJson);
        var alternatives = string.IsNullOrWhiteSpace(import.AlternativesJson) ? [] : Json.Read<List<ImportAlternative>>(import.AlternativesJson);
        return new ImportView(import.Id, import.Status, import.FileName, import.Pages, import.Error, import.Created, import.Model,
            import.Stage, import.ChunksDone, import.ChunksTotal, chunks.ElementAtOrDefault(import.ChunksDone)?.Label, unresolvedCount, draft,
            // Unmapped names are a review warning, not a reason to discard a faithful import;
            // a catalog id that went inactive is different and still needs rematching.
            unresolved, import.Status == ImportStatus.Ready && !import.CatalogStale, import.ProgramId, issues,
            import.InputTokens, import.OutputTokens, import.Retries, import.VisualFallbacks, import.SourceFileExpiresAt, coverage, alternatives, import.SelectedAlternativeId);
    }

    public static List<UnresolvedExercise> Unresolved(ImportDraft draft)
        => draft.Workouts.Where(w => !w.IsRestDay).SelectMany(w => w.Exercises).Where(e => e.ExerciseId == null)
            .Select(e => new UnresolvedExercise(e.LineId, e.SourceName)).ToList();

    private static List<ImportReviewIssue> ReviewIssues(ImportDraft draft)
    {
        var issues = new List<ImportReviewIssue>();
        foreach (var day in draft.Workouts.Where(w => !w.IsRestDay))
        {
            if (day.Weekday is null)
                issues.Add(new ImportReviewIssue("schedule_required", $"{day.Name} has no weekday yet; choose one before activation.", "blocking", day.SourcePage));
            foreach (var set in day.Exercises.SelectMany(e => e.Sets).Where(s => !s.Warmup))
            {
                if (set.TargetRpe is null)
                    issues.Add(new ImportReviewIssue("rpe_unspecified", $"{day.Name} contains a working set without a target RPE; it will remain unspecified.", "warning", set.SourcePage ?? day.SourcePage));
                if (set.RestSeconds is null && string.IsNullOrWhiteSpace(set.RestText))
                    issues.Add(new ImportReviewIssue("rest_unspecified", $"{day.Name} contains a set without a stated rest; it will remain unspecified.", "warning", set.SourcePage ?? day.SourcePage));
            }
        }
        return issues;
    }

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
        await files.Append(upload.SourceFileKey, offset, bytes, upload.ExpectedBytes, ct);
        upload.ReceivedBytes += bytes.Length; upload.Revision++;
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
            // background extraction continuation. The resumable part is removed immediately.
            // Once the upload has been committed, let outline processing finish even if the
            // browser closes. Extraction chunks are persisted separately and can be resumed by
            // the worker, so a disconnected response must not roll the import back.
            var processingCt = CancellationToken.None;
            var result = await Create(pdf, fileName, processingCt);
            await files.Delete(sourceKey, processingCt);
            await using var cleanupGate = await MutationLock.Acquire(db, db.CurrentUser, processingCt);
            var row = await db.ImportUploads.SingleOrDefaultAsync(x => x.Id == id, processingCt);
            if (row is not null) db.ImportUploads.Remove(row);
            await db.SaveChangesAsync(processingCt); await cleanupGate.Commit(processingCt);
            return result;
        }
        catch
        {
            // Restore the resumable session even when the request was cancelled. The original
            // exception remains authoritative; the 24-hour expiry is the cleanup backstop.
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
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var upload = await db.ImportUploads.SingleOrDefaultAsync(x => x.Id == id, ct);
        Validation.Require(upload != null, "That upload session has expired. Start the upload again.", 404);
        Validation.Require(upload!.Status == "open", "This upload is already being processed and cannot be cancelled.", 409);
        await files.Delete(upload!.SourceFileKey, ct); db.ImportUploads.Remove(upload);
        await db.SaveChangesAsync(ct); await gate.Commit(ct);
    }

    private static ImportUploadView ToUploadView(ImportUpload upload)
        => new(upload.Id, upload.FileName, upload.ExpectedBytes, upload.ReceivedBytes, UploadChunkBytes, upload.Status, upload.ExpiresAt);

    public async Task<ImportView> Create(byte[] pdf, string fileName, CancellationToken ct)
    {
        ValidatePdf(pdf, fileName);
        var user = db.CurrentUser!.Value;
        int? nextChunk = null;
        Guid importId;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
        var hash = Convert.ToHexString(SHA256.HashData(pdf));
        var existing = await db.Imports.AsNoTracking().FirstOrDefaultAsync(i => i.DocumentHash == hash && i.PromptVersion == WorkoutAi.PromptVersion
            && (i.Status == ImportStatus.Pending || i.Status == ImportStatus.Ready || i.Status == ImportStatus.Accepted), ct);
        if (existing != null)
        {
            await gate.Commit(ct);
            return await Get(existing.Id, ct);
        }

        var import = new AiImport
        {
            UserId = user, DocumentHash = hash, PromptVersion = WorkoutAi.PromptVersion,
            FileName = fileName.Trim(), Pages = PdfInspection.ApproximatePages(pdf), Status = ImportStatus.Pending, Stage = "outline"
        };
        import.PageCoverageJson = Json.Write(PdfInspection.Coverage(pdf));
        db.Imports.Add(import);
        await db.SaveChangesAsync(ct);
        import.SourceFileKey = await files.Save(user, import.Id, pdf, ct);
        import.SourceFileExpiresAt = DateTime.UtcNow.AddHours(24);
        await db.SaveChangesAsync(ct);

        try
        {
            await Meter(import, ct);
            // Exercise matching is local and happens after each chunk is parsed. The catalog is
            // deliberately absent from outline/extraction requests so a long library cannot consume
            // context tokens or bias the transcription toward a near match.
            var result = await ai.Outline(pdf, import.FileName, [], AuthService.Hash(user.ToString())[..32], ct);
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
                await files.Delete(import.SourceFileKey, ct); import.SourceFileKey = ""; import.SourceFileExpiresAt = null;
            }
            else
            {
                var alternatives = result.Outline!.Alternatives ?? [];
                if (alternatives.Count > 1)
                {
                    import.AlternativesJson = Json.Write(alternatives.Select(a => new ImportAlternative(a.Id, a.Name, a.Description,
                        a.Chunks.Count, a.Chunks.Sum(c => c.DayCount), a.Chunks.Select(ToImportChunk).ToList())).ToList());
                    import.Stage = "select"; import.Status = ImportStatus.Pending; import.ChunksDone = 0; import.ChunksTotal = 0;
                    import.DraftJson = Json.Write(new ImportDraft(result.Outline.ProgramTitle, result.Outline.Description, []));
                }
                else
                {
                    var selected = alternatives.Count == 1 ? alternatives[0] : null;
                    var chunks = SplitChunks((selected?.Chunks ?? result.Outline.Chunks).Select(c => c with { }).ToList());
                    ValidateChunkPages(chunks, import.PageCoverageJson);
                    import.SelectedAlternativeId = selected?.Id ?? "";
                    import.OutlineJson = Json.Write(chunks);
                    import.DraftJson = Json.Write(new ImportDraft(selected?.Name ?? result.Outline.ProgramTitle, selected?.Description ?? result.Outline.Description, []));
                    import.Stage = "extract"; import.Status = ImportStatus.Pending; import.ChunksDone = 0; import.ChunksTotal = chunks.Count;
                    import.UnresolvedCount = 0; import.CatalogStale = false;
                }
            }
        }
        catch (DomainException ex)
        {
            import.Status = ImportStatus.Failed; import.Error = ex.Message;
            await files.Delete(import.SourceFileKey, ct); import.SourceFileKey = ""; import.SourceFileExpiresAt = null;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            throw;
        }
        MarkDispatch(import);
        importId = import.Id;
        nextChunk = import.PendingDispatchChunk;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        }
        await TryDispatch(user, importId, nextChunk, ct);
        return await Get(importId, ct);
    }

    public async Task<ImportView> SelectAlternative(Guid id, string alternativeId, CancellationToken ct)
    {
        var user = db.CurrentUser!.Value;
        int? nextChunk = null;
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
        await TryDispatch(user, id, nextChunk, ct);
        return await Get(id, ct);
    }

    private static ImportChunk ToImportChunk(AiOutlineChunk chunk)
        => new(chunk.Label, chunk.Block, chunk.Phase, chunk.WeekFrom, chunk.WeekTo, chunk.PageFrom, chunk.PageTo, chunk.DayCount);

    public async Task<ImportView> Extract(Guid id, byte[] pdf, string fileName, CancellationToken ct, int? expectedChunk = null)
    {
        var user = db.CurrentUser!.Value;
        int? nextChunk = null;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        // A duplicate delivery after the last chunk committed is already complete and is safe to
        // acknowledge without asking the model to read the document again.
        if (import!.Status == ImportStatus.Ready && import.Stage == "done")
        {
            await gate.Commit(ct);
            return await Get(id, ct);
        }
        Validation.Require(import.Status == ImportStatus.Pending && import.Stage == "extract", "This import is not waiting for another extraction pass.", 409);
        if (expectedChunk is { } expected)
        {
            // A stale duplicate is acknowledged after a later chunk has committed. A future task
            // cannot advance the import out of order and is retried after its predecessor.
            if (import.ChunksDone > expected)
            {
                await gate.Commit(ct);
                return await Get(id, ct);
            }
            Validation.Require(import.ChunksDone == expected, "This extraction chunk is not ready yet; retry after the previous chunk commits.", 409);
        }
        if (pdf.Length == 0)
        {
            Validation.Require(!string.IsNullOrWhiteSpace(import.SourceFileKey), "The temporary PDF has expired. Upload it again.", 410);
            pdf = await files.Read(import.SourceFileKey, ct); fileName = import.FileName;
        }
        ValidatePdf(pdf, fileName);
        var hash = Convert.ToHexString(SHA256.HashData(pdf));
        Validation.Require(hash == import.DocumentHash, "Choose the same PDF that started this import so the next chunk can be verified.", 409);
        var chunks = ReadChunks(import.OutlineJson);
        Validation.Require(import.ChunksDone < chunks.Count, "This import has already finished extracting.", 409);
        var chunk = chunks[import.ChunksDone];
        ValidateChunkPages([chunk], import.PageCoverageJson);
        try
        {
            await Meter(import, ct);
            var result = await ai.ExtractChunk(pdf, import.FileName, [], AuthService.Hash(db.CurrentUser!.Value.ToString())[..32],
                $"Extract only chunk '{chunk.Label}', covering block '{chunk.Block}', phase '{chunk.Phase}', absolute weeks {chunk.WeekFrom}-{chunk.WeekTo}, pages {chunk.PageFrom}-{chunk.PageTo}. Return those days and no days from other chunks.", ct, chunk.PageFrom, chunk.PageTo);
            var existing = Json.Read<ImportDraft>(import.DraftJson);
            var extracted = await ToDraft(result.Program, ct);
            ValidateChunkCoverage(existing, extracted, chunk);
            var title = result.Program.ProgramTitle ?? result.Program.ProgramName ?? existing.ProgramName;
            var description = result.Program.Description ?? existing.Description;
            var merged = existing with { ProgramName = title, Description = description, Workouts = [.. existing.Workouts, .. extracted.Workouts] };
            import.DraftJson = Json.Write(merged); import.ChunksDone++; import.Revision++; import.Model = result.Model;
            import.InputTokens += result.InputTokens; import.OutputTokens += result.OutputTokens;
            import.VisualFallbacks += result.VisualFallback ? 1 : 0; import.Error = "";
            if (import.ChunksDone >= import.ChunksTotal)
            {
                await ValidateDraft(merged, ct);
                ValidateDraftPages(merged, import.PageCoverageJson);
                import.Status = ImportStatus.Ready; import.Stage = "done"; UpdateCounters(import, merged);
                await files.Delete(import.SourceFileKey, ct); import.SourceFileKey = ""; import.SourceFileExpiresAt = null;
            }
            MarkDispatch(import);
            nextChunk = import.PendingDispatchChunk;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        catch (DomainException ex)
        {
            import.Error = ex.Message;
            import.Retries++;
            if (expectedChunk is { } expectedChunkValue && import.ChunksDone == expectedChunkValue)
            {
                import.PendingDispatchChunk = expectedChunkValue;
                import.PendingDispatchAt = DateTime.UtcNow;
            }
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            throw;
        }
        }
        await TryDispatch(user, id, nextChunk, ct);
        return await Get(id, ct);
    }

    /// Retry is an explicit idempotent operation for a failed/pending extraction chunk. The
    /// persisted source is reused when it is still inside its retention window; callers can use
    /// the existing extract endpoint with the PDF when that source has expired.
    public Task<ImportView> Retry(Guid id, CancellationToken ct) => Extract(id, [], "", ct);

    /// Every id the model proposes is checked against the live catalog here. An id that does not
    /// resolve is dropped to null so the reviewer can keep the written exercise name.
    public async Task<ImportDraft> ToDraft(AiProgram program, CancellationToken ct)
    {
        var active = await catalog.ActiveIds(ct);
        var title = program.ProgramTitle ?? program.ProgramName ?? "Imported program";
        var workouts = new List<DraftWorkout>();
        if (program.Days is { } days)
        {
            foreach (var day in days)
                workouts.Add(await ToDraftWorkout(day.Block, day.Phase, day.WeekNumber, day.PhaseWeek, day.DayName, day.IsRestDay, day.Notes, day.Exercises, active, ct, weekday: day.Weekday, sourcePage: day.SourcePage));
        }
        else
        {
            foreach (var week in program.Weeks!.OrderBy(w => w.Week))
                foreach (var workout in week.Workouts ?? [])
                    workouts.Add(await ToDraftWorkout(null, null, week.Week, 1, workout.Name, false, workout.Notes, workout.Exercises, active, ct, workout.Focus));
        }
        return new ImportDraft(title.Trim(), program.Description, workouts);
    }

    private async Task<DraftWorkout> ToDraftWorkout(string? block, string? phase, int week, int phaseWeek, string name, bool restDay,
        string? notes, List<AiExercise> sourceExercises, HashSet<Guid> active, CancellationToken ct, string? focus = null,
        int? weekday = null, int? sourcePage = null)
    {
        var exercises = new List<DraftExercise>();
        if (!restDay)
        {
            foreach (var source in sourceExercises)
            {
                Guid? id = Guid.TryParse(source.ExerciseId, out var parsed) && active.Contains(parsed) ? parsed : null;
                id ??= await catalog.Match(source.SourceName, ct);
                var working = source.Sets.Select(ToDraftSet).ToList();
                var warmups = ParseWarmupCount(source.WarmupSets);
                if (warmups > 0)
                {
                    var seed = working[0];
                    var warmup = seed with { Warmup = true, RepsSource = "inferred", RpeSource = seed.TargetRpe == null ? "inferred" : seed.RpeSource };
                    working.InsertRange(0, Enumerable.Repeat(warmup, warmups));
                }
                var noteParts = new[] { source.Notes, source.CoachingNotes }.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim()).ToList();
                var substitutions = (source.Substitutions ?? []).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).Take(2).ToList();
                exercises.Add(new DraftExercise(Guid.NewGuid(), source.SourceName.Trim(), id, noteParts.Count == 0 ? null : string.Join(" — ", noteParts), working,
                    source.SequenceGroup?.Trim() ?? "", substitutions, source.SourcePage));
            }
        }
        return new DraftWorkout(Guid.NewGuid(), week, name.Trim(), focus, notes, exercises, block, phase, phaseWeek, restDay, weekday, sourcePage);
    }

    private static DraftSet ToDraftSet(AiSet set)
    {
        var reps = DeriveReps(set.RepsText, set.RepMin, set.RepMax);
        var rest = DeriveRest(set.RestText, set.RestSeconds);
        var repsSource = set.RepsSource;
        if (!string.IsNullOrWhiteSpace(set.RepsText) && !Regex.IsMatch(set.RepsText.Trim(), @"^\d+\s*(?:[-–]\s*\d+)?$")) repsSource = "inferred";
        var rpe = set.TargetRpe;
        var rpeSource = set.RpeSource;
        if (rpe == null && TryFirstNumber(set.Rir, out var rir))
        {
            // RIR is useful evidence, but an out-of-range conversion is not a reason to invent a
            // target that the document never supplied. Leave it visibly unresolved for review.
            var inferred = 10 - rir;
            if (inferred is >= 6 and <= 10) { rpe = inferred; rpeSource = "inferred"; }
        }
        return new DraftSet(reps.Min, reps.Max, rpe, rest, set.Tempo, set.LoadText, set.Notes,
            repsSource, rpeSource, set.RestSource, NullIfBlank(set.RepsText), NullIfBlank(set.RestText), NullIfBlank(set.Percent1Rm), NullIfBlank(set.Rir), false, set.SourcePage);
    }

    private static (int Min, int Max) DeriveReps(string? text, int min, int max)
    {
        if (string.IsNullOrWhiteSpace(text)) return (min, max);
        // AMRAP, dropsets (10+5), 21s (7/7/7), and similar notation stay in repsText. The
        // numeric bounds supplied by the model remain the reviewable planning bounds; collapsing
        // the notation into a made-up single target would change what the PDF says.
        return (min, max);
    }

    private static int? DeriveRest(string? text, int? fallback)
    {
        if (string.IsNullOrWhiteSpace(text)) return fallback;
        var numbers = NumberMatches(text).ToList();
        if (numbers.Count != 1 || !TryFirstNumber(text, out var number)) return fallback;
        var lower = text.ToLowerInvariant();
        return (int)Math.Round(number * (lower.Contains("min") ? 60 : 1), MidpointRounding.AwayFromZero);
    }

    private static int ParseWarmupCount(string? text)
    {
        if (!TryFirstNumber(text, out var number)) return 0;
        return Math.Clamp((int)Math.Floor(number), 0, 8);
    }

    private static bool TryFirstNumber(string? text, out double value)
    {
        var match = Regex.Match(text ?? "", @"\d+(?:\.\d+)?");
        if (!match.Success || !double.TryParse(match.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out value)) { value = 0; return false; }
        return true;
    }

    private static IEnumerable<int> NumberMatches(string text)
        => Regex.Matches(text, @"\d+").Select(m => int.TryParse(m.Value, out var value) ? value : 0).Where(v => v > 0);

    private async Task<ImportView> SaveDraft(Guid id, ImportDraft draft, CancellationToken ct)
    {
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        await ValidateDraft(draft, ct);
        import.DraftJson = Json.Write(draft); import.Revision++; UpdateCounters(import, draft);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    public async Task<ImportView> Edit(Guid id, ImportDraft draft, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var result = await SaveDraft(id, draft, ct);
        await gate.Commit(ct);
        return result;
    }

    public async Task<ImportView> EditMetadata(Guid id, ImportMetadata metadata, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        var current = Json.Read<ImportDraft>(import.DraftJson);
        var next = current with { ProgramName = metadata.ProgramName, Description = metadata.Description };
        Validation.Name(next.ProgramName, "Program name"); Validation.Text(next.Description, 4000, "Program description");
        import.DraftJson = Json.Write(next); import.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    public async Task<ImportView> EditDay(Guid id, Guid lineId, DraftWorkout day, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        Validation.Require(day.LineId == lineId, "That day does not match the requested draft line.", 400);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        var draft = Json.Read<ImportDraft>(import.DraftJson);
        Validation.Require(draft.Workouts.Any(w => w.LineId == lineId), "That day no longer exists.", 404);
        await ValidateWorkout(day, ct);
        var next = draft with { Workouts = draft.Workouts.Select(w => w.LineId == lineId ? day : w).ToList() };
        import.DraftJson = Json.Write(next); import.Revision++; UpdateCounters(import, next);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    public async Task<ImportView> Rematch(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import has no draft to rematch.", 409);
        var draft = Json.Read<ImportDraft>(import.DraftJson);
        var active = await catalog.ActiveIds(ct);
        var workouts = new List<DraftWorkout>();
        foreach (var workout in draft.Workouts)
        {
            var exercises = workout.Exercises.Select(async exercise =>
            {
                var resolved = exercise.ExerciseId is { } current && active.Contains(current) ? current : await catalog.Match(exercise.SourceName, ct);
                return exercise with { ExerciseId = resolved };
            }).ToList();
            workouts.Add(workout with { Exercises = (await Task.WhenAll(exercises)).ToList() });
        }
        var next = draft with { Workouts = workouts };
        import.DraftJson = Json.Write(next); import.Revision++; UpdateCounters(import, next);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    /// Acceptance is all-or-nothing: unmatched exercise names are intentionally kept as
    /// unresolved rows and remain usable through name-based history matching.
    // The original overload remains for callers compiled against the first importer. It follows
    // the safe default; new HTTP clients send an explicit acknowledgement when optional RPE/rest
    // values are unresolved.
    public Task<ProgramView> Accept(Guid id, CancellationToken ct) => Accept(id, null, false, ct);

    public Task<ProgramView> Accept(Guid id, string? timeZone, CancellationToken ct) => Accept(id, timeZone, false, ct);

    public async Task<ProgramView> Accept(Guid id, string? timeZone, bool acknowledgeUnspecified, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import has already been accepted or discarded.", 409);
        var draft = Json.Read<ImportDraft>(import.DraftJson);
        await ValidateDraft(draft, ct);
        ValidateDraftPages(draft, import.PageCoverageJson);
        var unspecified = ReviewIssues(draft).Where(issue => issue.Code is "rpe_unspecified" or "rest_unspecified").ToList();
        Validation.Require(acknowledgeUnspecified || unspecified.Count == 0,
            "Acknowledge the unspecified RPE or rest values in the review before accepting this program.", 409);
        var input = new ProgramInput(draft.ProgramName, draft.Description,
            draft.Workouts.Select(w => new ProgramWorkoutInput(w.Week, w.Name, w.Focus, w.Notes,
                w.Exercises.Select(e => new TemplateExerciseInput(e.ExerciseId, e.SourceName, e.Notes,
                    e.Sets.Select(ToPrescription).ToList(), e.SequenceGroup, e.Substitutions, e.SourcePage)).ToList(),
                w.Block, w.Phase, w.PhaseWeek, w.IsRestDay, w.Weekday, w.SourcePage)).ToList(), null, null, timeZone);
        await programs.Validate(input, ct, allowMissingWorkingRpe: true, allowOutOfRangeTargetRpe: true);
        // Imported drafts always enter Standby. Even a fully scheduled PDF must be explicitly
        // activated by the user so a mistaken import never displaces the current program.
        var program = await programs.Materialize(input, activate: false, sourceImportId: import.Id, ct);
        import.Status = ImportStatus.Accepted; import.ProgramId = program.Id; import.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await programs.Get(program.Id, ct);
    }

    public async Task Discard(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status != ImportStatus.Accepted, "An accepted program is removed from Programs, not here.", 409);
        await files.Delete(import.SourceFileKey, ct);
        import.Status = ImportStatus.Discarded; import.DraftJson = ""; import.OutlineJson = ""; import.Revision++;
        import.SourceFileKey = ""; import.SourceFileExpiresAt = null;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public async Task CleanupExpired(CancellationToken ct)
    {
        var previousMaintenance = db.MaintenanceAccess;
        db.MaintenanceAccess = true;
        try
        {
        var now = DateTime.UtcNow;
        var expired = await db.Imports.IgnoreQueryFilters().Where(i => i.SourceFileExpiresAt != null && i.SourceFileExpiresAt < now && i.SourceFileKey != "").ToListAsync(ct);
        foreach (var import in expired)
        {
            await files.Delete(import.SourceFileKey, ct);
            import.SourceFileKey = ""; import.SourceFileExpiresAt = null;
            if (import.Status == ImportStatus.Pending) { import.Status = ImportStatus.Failed; import.Error = "The temporary PDF expired before extraction finished. Upload it again."; }
        }
        var uploads = await db.ImportUploads.IgnoreQueryFilters().Where(x => x.ExpiresAt < now).ToListAsync(ct);
        foreach (var upload in uploads)
        {
            await files.Delete(upload.SourceFileKey, ct);
            db.ImportUploads.Remove(upload);
        }
        if (expired.Count > 0 || uploads.Count > 0) await db.SaveChangesAsync(ct);
        }
        finally { db.MaintenanceAccess = previousMaintenance; }
    }

    /// Re-enqueues extraction chunks whose delivery was never accepted or whose delivery lease
    /// expired while a worker was restarting. This is intentionally bounded so the maintenance
    /// endpoint remains cheap even if a user has accumulated stale imports.
    public async Task<int> RecoverUndispatched(CancellationToken ct)
    {
        if (jobs is null) return 0;
        var previousUser = db.CurrentUser;
        var previousMaintenance = db.MaintenanceAccess;
        db.MaintenanceAccess = true;
        try
        {
            var now = DateTime.UtcNow;
            var candidates = await db.Imports.IgnoreQueryFilters().AsNoTracking()
                .Where(i => i.Status == ImportStatus.Pending && i.Stage == "extract" &&
                    i.ChunksDone < i.ChunksTotal &&
                    (i.PendingDispatchChunk == null || i.PendingDispatchAt == null || i.PendingDispatchAt <= now))
                .OrderBy(i => i.Created).Take(32)
                .Select(i => new { i.UserId, i.Id, Chunk = i.PendingDispatchChunk ?? i.ChunksDone }).ToListAsync(ct);
            var recovered = 0;
            foreach (var candidate in candidates)
            {
                if (await TryDispatch(candidate.UserId, candidate.Id, candidate.Chunk, ct)) recovered++;
                db.ChangeTracker.Clear();
            }
            return recovered;
        }
        finally
        {
            db.CurrentUser = previousUser;
            db.MaintenanceAccess = previousMaintenance;
        }
    }

    private void MarkDispatch(AiImport import)
    {
        if (import.Status == ImportStatus.Pending && import.Stage == "extract" && import.ChunksDone < import.ChunksTotal)
        {
            import.PendingDispatchChunk = import.ChunksDone;
            import.PendingDispatchAt = DateTime.UtcNow;
        }
        else
        {
            import.PendingDispatchChunk = null;
            import.PendingDispatchAt = null;
        }
    }

    private async Task<bool> TryDispatch(Guid userId, Guid importId, int? expectedChunk, CancellationToken ct)
    {
        if (jobs is null || expectedChunk is not { } chunk) return false;
        if (!await jobs.Enqueue(userId, importId, chunk, ct)) return false;

        var previousUser = db.CurrentUser;
        db.CurrentUser = userId;
        try
        {
            await using var gate = await MutationLock.Acquire(db, userId, ct);
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, ct);
            if (import is not null && import.Status == ImportStatus.Pending && import.Stage == "extract" &&
                import.ChunksDone == chunk && (import.PendingDispatchChunk is null || import.PendingDispatchChunk == chunk))
            {
                // Keep the marker until the task commits. The lease lets hourly maintenance
                // recover a task lost during worker startup without creating an unbounded queue.
                import.PendingDispatchAt = DateTime.UtcNow.AddMinutes(30);
                import.Revision++;
                await db.SaveChangesAsync(ct);
            }
            await gate.Commit(ct);
            return true;
        }
        finally { db.CurrentUser = previousUser; }
    }

    public async Task ValidateDraft(ImportDraft draft, CancellationToken ct)
    {
        Validation.Name(draft.ProgramName, "Program name");
        Validation.Text(draft.Description, 4000, "Program description");
        Validation.Require(draft.Workouts is { Count: > 0 and <= 400 }, "A program needs between 1 and 400 days.");
        Validation.Require(draft.Workouts.All(w => w.Week is > 0 and <= 104), "Program weeks must be between 1 and 104.");
        Validation.Require(draft.Workouts.Select(w => w.LineId).Distinct().Count() == draft.Workouts.Count, "A program contains duplicate workout rows.");
        var scheduled = draft.Workouts.Where(w => w.Weekday is not null).Select(w => (w.Week, Weekday: w.Weekday!.Value)).ToList();
        Validation.Require(scheduled.Count == scheduled.Distinct().Count(), "A program contains two workouts on the same weekday in one week.");
        foreach (var phase in GroupDraftPhases(draft.Workouts))
        {
            var phaseWeeks = phase.Select(w => w.PhaseWeek).Distinct().OrderBy(value => value).ToList();
            Validation.Require(phaseWeeks.Count == 0 || phaseWeeks.Select((value, index) => value == index + 1).All(value => value),
                $"Phase '{phase[0].Phase}' has a missing phase week. Review the outline before accepting it.", 422);
            var absoluteWeeks = phase.Select(w => w.Week).Distinct().OrderBy(value => value).ToList();
            Validation.Require(absoluteWeeks.Count == 0 || absoluteWeeks.SequenceEqual(Enumerable.Range(absoluteWeeks[0], absoluteWeeks[^1] - absoluteWeeks[0] + 1)),
                $"Phase '{phase[0].Phase}' has a missing absolute week. Review the outline before accepting it.", 422);
        }
        foreach (var workout in draft.Workouts) await ValidateWorkout(workout, ct);
    }

    private async Task ValidateWorkout(DraftWorkout workout, CancellationToken ct)
    {
        Validation.Name(workout.Name, "Workout name");
        Validation.Text(workout.Block, 80, "Block"); Validation.Text(workout.Phase, 120, "Phase");
        Validation.Text(workout.Focus, 120, "Focus"); Validation.Text(workout.Notes, 2000, "Workout notes");
        Validation.Require(workout.PhaseWeek is > 0 and <= 104, "Phase week must be between 1 and 104.");
        Validation.Require(workout.Weekday is null or >= 1 and <= 7, "Workout weekdays must use ISO values from 1 (Monday) to 7 (Sunday).");
        Validation.Require(workout.IsRestDay ? workout.Exercises is { Count: 0 } : workout.Exercises is { Count: > 0 and <= 40 },
            workout.IsRestDay ? "A rest day cannot contain exercises." : "Each workout needs between 1 and 40 exercises.");
        foreach (var exercise in workout.Exercises)
        {
            Validation.Name(exercise.SourceName, "Exercise name", 160); Validation.Text(exercise.Notes, 1000, "Exercise notes");
            Validation.Require(exercise.SourcePage is null || exercise.SourcePage.Value is > 0 and <= PdfInspection.MaxPages, "Exercise source page is invalid.");
            Validation.Text(exercise.SequenceGroup, 8, "Sequence group"); Validation.Substitutions(exercise.Substitutions);
            // Imported notation is preserved for review, including unusual but valid 1-10
            // target RPE values; manual program editing keeps the stricter training range.
            Validation.Prescriptions(exercise.Sets.Select(ToPrescription).ToList(), false, true);
            foreach (var set in exercise.Sets)
            {
                Validation.Require(set.SourcePage is null || set.SourcePage.Value is > 0 and <= PdfInspection.MaxPages, "Set source page is invalid.");
                foreach (var source in new[] { set.RepsSource, set.RpeSource, set.RestSource })
                    Validation.Require(source is "extracted" or "inferred" or "userEdited", "Unknown provenance label.");
            }
            await catalog.RequireActive(exercise.ExerciseId, ct);
        }
    }

    private static List<List<DraftWorkout>> GroupDraftPhases(IEnumerable<DraftWorkout> workouts)
    {
        var ordered = workouts.Select((workout, index) => (workout, index))
            .OrderBy(item => item.workout.Week).ThenBy(item => item.index).Select(item => item.workout).ToList();
        var groups = new List<List<DraftWorkout>>();
        foreach (var workout in ordered)
        {
            var previous = groups.Count == 0 ? null : groups[^1][^1];
            var same = previous is not null &&
                string.Equals(previous.Block?.Trim() ?? "", workout.Block?.Trim() ?? "", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(previous.Phase?.Trim() ?? "", workout.Phase?.Trim() ?? "", StringComparison.OrdinalIgnoreCase);
            var reset = previous is not null && previous.PhaseWeek > 1 && workout.Week > previous.Week && workout.PhaseWeek <= previous.PhaseWeek;
            if (groups.Count == 0 || !same || reset) groups.Add([]);
            groups[^1].Add(workout);
        }
        return groups;
    }

    private static SetPrescription ToPrescription(DraftSet set)
        => new(set.RepMin, set.RepMax, set.TargetRpe, set.RestSeconds, set.Tempo, set.LoadText, set.Notes,
            set.RepsText, set.RestText, set.Percent1Rm, set.Rir, set.Warmup, set.RepsSource, set.RpeSource, set.RestSource,
            SourcePage: set.SourcePage);

    private static List<ImportChunk> SplitChunks(List<AiOutlineChunk> source)
    {
        // The outline model owns the semantic boundaries. Never derive week ranges from a count
        // of training days: a three-day schedule and a seven-day schedule have different weeks.
        Validation.Require(source.Count is > 0 and <= 24, "This program has too many extraction chunks.", 422);
        var result = source.Select(chunk => new ImportChunk(chunk.Label, chunk.Block, chunk.Phase, chunk.WeekFrom, chunk.WeekTo,
            chunk.PageFrom, chunk.PageTo, chunk.DayCount)).ToList();
        Validation.Require(result.Select(c => c.Label).Distinct(StringComparer.OrdinalIgnoreCase).Count() == result.Count,
            "AI returned duplicate extraction chunk labels.", 422);
        ValidateChunkRanges(result);
        Validation.Require(result.Sum(c => c.DayCount) <= 400, "This program is larger than the importer supports.", 422);
        return result;
    }

    private static List<ImportChunk> SplitChunks(List<ImportChunk> source)
    {
        Validation.Require(source.Count is > 0 and <= 24, "This program has too many extraction chunks.", 422);
        Validation.Require(source.Select(c => c.Label).Distinct(StringComparer.OrdinalIgnoreCase).Count() == source.Count,
            "AI returned duplicate extraction chunk labels.", 422);
        Validation.Require(source.All(c => c.DayCount is > 0 and <= 80 && c.WeekFrom > 0 && c.WeekTo >= c.WeekFrom && c.PageFrom > 0 && c.PageTo >= c.PageFrom),
            "AI returned an invalid extraction chunk.", 422);
        ValidateChunkRanges(source);
        Validation.Require(source.Sum(c => c.DayCount) <= 400, "This program is larger than the importer supports.", 422);
        return source;
    }

    private static void ValidateChunkRanges(IEnumerable<ImportChunk> chunks)
    {
        foreach (var group in chunks.GroupBy(c => (Block: c.Block?.Trim() ?? "", Phase: c.Phase?.Trim() ?? "")))
        {
            var ordered = group.OrderBy(c => c.WeekFrom).ThenBy(c => c.PageFrom).ThenBy(c => c.WeekTo).ToList();
            for (var index = 1; index < ordered.Count; index++)
            {
                var previous = ordered[index - 1]; var current = ordered[index];
                if (current.WeekFrom <= previous.WeekTo)
                {
                    // A phase may be split into page sections for the same week. That is safe
                    // only when the source ranges are disjoint; extracted duplicate slots are
                    // rejected again when the chunks are merged.
                    Validation.Require(current.PageFrom > previous.PageTo || current.PageTo < previous.PageFrom,
                        $"Extraction chunks for phase '{group.Key.Phase}' overlap in their source pages. Review the outline before continuing.", 422);
                }
                else
                {
                    Validation.Require(current.WeekFrom == previous.WeekTo + 1,
                        $"Extraction chunks for phase '{group.Key.Phase}' skip a week. Review the outline before continuing.", 422);
                }
            }
        }
    }

    private static List<ImportChunk> ReadChunks(string json)
        => string.IsNullOrWhiteSpace(json) ? [] : Json.Read<List<ImportChunk>>(json);

    private static void ValidateChunkCoverage(ImportDraft existing, ImportDraft extracted, ImportChunk chunk)
    {
        Validation.Require(extracted.Workouts.Count == chunk.DayCount,
            $"AI returned {extracted.Workouts.Count} days for '{chunk.Label}', but the outline expects {chunk.DayCount}. Review or retry this chunk.", 422);
        Validation.Require(extracted.Workouts.All(day => day.Week >= chunk.WeekFrom && day.Week <= chunk.WeekTo),
            $"AI returned a day outside the week range for '{chunk.Label}'. Retry this chunk.", 422);
        var existingKeys = existing.Workouts.Select(DayKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var chunkKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var day in extracted.Workouts)
        {
            var key = DayKey(day);
            Validation.Require(chunkKeys.Add(key) && !existingKeys.Contains(key),
                $"AI returned a duplicate workout day for '{chunk.Label}'. Retry this chunk.", 422);
        }
    }

    private static string DayKey(DraftWorkout day)
        => $"{day.Week}|{day.PhaseWeek}|{day.Block?.Trim()}|{day.Phase?.Trim()}|{day.Weekday}|{day.Name.Trim()}";

    private void UpdateCounters(AiImport import, ImportDraft draft)
    {
        var unresolved = Unresolved(draft);
        import.UnresolvedCount = unresolved.Count;
        import.CatalogStale = draft.Workouts.SelectMany(w => w.Exercises).Any(e => e.ExerciseId is null ? false : !db.Exercises.Any(x => x.Id == e.ExerciseId && x.Active));
    }

    private async Task Meter(AiImport import, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var usage = await db.Usage.SingleOrDefaultAsync(u => u.Date == today, ct);
        if (usage == null) { usage = new AiUsage { UserId = db.CurrentUser!.Value, Date = today, Count = 0 }; db.Usage.Add(usage); }
        Validation.Require(usage.Count < DailyLimit, $"You have used all {DailyLimit} AI reads for today. Manual program building remains available.", 429);
        usage.Count++; import.Calls++;
        await db.SaveChangesAsync(ct);
    }

    private static void ValidatePdf(byte[] pdf, string fileName)
    {
        Validation.Require(pdf.Length > 0, "Choose a PDF to import.");
        Validation.Require(pdf.Length <= PdfInspection.MaxBytes, "That PDF is larger than 150 MiB.", 413);
        Validation.Require(PdfInspection.LooksLikePdf(pdf), "That file is not a PDF.");
        var pages = PdfInspection.ApproximatePages(pdf);
        Validation.Require(pages > 0, "The PDF page structure could not be read. Choose a complete PDF file.", 422);
        Validation.Require(pages <= PdfInspection.MaxPages, $"That PDF has about {pages} pages; the importer accepts up to {PdfInspection.MaxPages}.");
        Validation.Name(fileName, "File name", 200);
    }

    private static void ValidateChunkPages(IEnumerable<ImportChunk> chunks, string coverageJson)
    {
        if (string.IsNullOrWhiteSpace(coverageJson)) return;
        var coverage = Json.Read<List<PdfPageCoverage>>(coverageJson);
        if (coverage.Count == 0) return;
        var pageCount = coverage.Max(page => page.Page);
        foreach (var chunk in chunks)
            Validation.Require(chunk.PageFrom <= pageCount && chunk.PageTo <= pageCount,
                $"Extraction chunk '{chunk.Label}' refers to pages outside this PDF. Review the outline and retry.", 422);
    }

    private static void ValidateDraftPages(ImportDraft draft, string coverageJson)
    {
        if (string.IsNullOrWhiteSpace(coverageJson)) return;
        var coverage = Json.Read<List<PdfPageCoverage>>(coverageJson);
        if (coverage.Count == 0) return;
        var pageCount = coverage.Max(page => page.Page);
        foreach (var page in draft.Workouts.SelectMany(workout =>
                     new[] { workout.SourcePage }.Concat(workout.Exercises.Select(exercise => exercise.SourcePage))
                         .Concat(workout.Exercises.SelectMany(exercise => exercise.Sets).Select(set => set.SourcePage))))
            Validation.Require(page is null || page.Value <= pageCount,
                "The extracted program refers to a source page outside this PDF. Review the draft and retry.", 422);
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
