using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// The AI reading pipeline. The browser extracts the PDF's text on the device and submits only
/// that text, so this service never holds a document, an object-store key, or an upload session.
///
/// One rule shapes the transactions here: a model read can take minutes, so it never runs inside
/// the per-user mutation transaction. Holding the advisory lock across it would block every other
/// request from that account and lose the whole read if the connection drops. Each pass therefore
/// claims its work in a short transaction, calls the model outside any transaction, and commits
/// the result in a second short transaction — including when the browser has already given up,
/// because the read has been paid for either way.
public sealed partial class ImportService
{
    public const int DailyLimit = 150;

    /// Accepts the extracted text and reads its outline. Submitting the same document again while
    /// an unfinished import exists continues that import rather than starting a second one.
    ///
    /// Reading a program is refused outright while a workout is open. An import ends by rewriting
    /// the account's programs and the day a session was started from, so letting the two overlap
    /// would move the ground under a workout already in progress. A read that is already running
    /// is unaffected: only starting a new one is blocked, so `/extract` and `/retry` stay open and
    /// an in-flight import can still finish and be retried.
    public async Task<ImportView> Create(ImportSourceInput input, CancellationToken ct)
    {
        Validation.Require(!await db.Workouts.AnyAsync(w => w.Active, ct),
            "Finish or discard the active workout before importing a program.", 409);
        var pages = ImportSourceText.Normalize(input);
        var hash = ImportSourceText.Hash(pages);
        var sourceJson = Json.Write(pages);
        var links = ImportDemoLinks.Normalize(input.Links, input.PageCount);
        Guid importId;
        bool readOutline;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.FirstOrDefaultAsync(i => i.DocumentHash == hash && i.PromptVersion == WorkoutAi.PromptVersion
                && (i.Status == ImportStatus.Pending || i.Status == ImportStatus.Ready || i.Status == ImportStatus.Accepted), ct);
            if (import == null)
            {
                import = new AiImport
                {
                    UserId = db.CurrentUser!.Value, DocumentHash = hash, PromptVersion = WorkoutAi.PromptVersion,
                    FileName = input.FileName.Trim(), Pages = input.PageCount,
                    Status = ImportStatus.Pending, Stage = "outline",
                    PageCoverageJson = Json.Write(ImportSourceText.Coverage(pages, input.PageCount))
                };
                db.Imports.Add(import);
            }
            if (import.Status == ImportStatus.Pending && string.IsNullOrEmpty(import.SourceTextJson))
            {
                import.SourceTextJson = sourceJson;
                // Links live with the source text: both are read from the document, and both are
                // only needed while the sections are still being assembled into a draft.
                import.LinksJson = links.Count > 0 ? Json.Write(links) : "";
                import.Error = ""; import.Revision++;
            }
            readOutline = import.Status == ImportStatus.Pending && import.Stage == "outline";
            await db.SaveChangesAsync(ct);
            importId = import.Id;
            await gate.Commit(ct);
        }
        db.ChangeTracker.Clear();
        if (readOutline) return await ReadOutline(importId, pages, ct);
        return await Get(importId, ct);
    }

    /// One outline pass. It reads a page-by-page view of the document, which for a large book is
    /// only the opening lines of each page: enough to locate the schedule, cheap enough that a
    /// hundred pages of coaching prose cost almost nothing.
    private async Task<ImportView> ReadOutline(Guid importId, List<ImportPageText> pages, CancellationToken ct, string? existingLeaseId = null)
    {
        var user = db.CurrentUser!.Value;
        var leaseId = existingLeaseId ?? NewLeaseId();
        await using (var claim = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            Validation.Require(import!.Status == ImportStatus.Pending && import.Stage == "outline", "This import has already been read.", 409);
            if (LeaseHeldByAnother(import, leaseId, DateTime.UtcNow))
            {
                await claim.Commit(ct);
                db.ChangeTracker.Clear();
                return await Get(importId, ct);
            }
            ClaimLease(import, leaseId, DateTime.UtcNow);
            await Meter(import, ct);
            await db.SaveChangesAsync(ct);
            await claim.Commit(ct);
        }
        db.ChangeTracker.Clear();

        AiOutlineResult result;
        try
        {
            result = await ai.Outline(ImportSourceText.Outline(pages), [], AuthService.Hash(user.ToString())[..32], ct);
        }
        catch (DomainException ex)
        {
            if (ex.Status == 429 || ex.Status >= 500)
                await RecordRetryableFailure(importId, ex.Message, leaseId);
            else
                await FailImport(importId, ex.Message, leaseId);
            throw;
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            // A transport or provider fault is not the document's fault. The extracted text is
            // kept so the same import can be read again without re-reading the PDF.
            await RecordRetryableFailure(importId, "Reading this PDF did not finish. Try again.", leaseId);
            throw;
        }

        // The read is paid for and complete: commit it even if the browser has since disconnected.
        var settle = CancellationToken.None;
        DomainException? rejected = null;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, settle))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
            if (import is not null && import.Status == ImportStatus.Pending && import.Stage == "outline" && OwnsLease(import, leaseId))
            {
                try
                {
                    await ApplyOutline(import, result, pages, settle);
                    if (import.Status == ImportStatus.Ready) ClearSource(import);
                    ReleaseLease(import);
                    import.Revision++;
                    await db.SaveChangesAsync(settle);
                }
                catch (DomainException ex)
                {
                    // The account lock is not reentrant, so the outcome is recorded once this
                    // gate has closed rather than from inside it.
                    if (ex is ImportVerificationException)
                        await db.SaveChangesAsync(settle);
                    db.ChangeTracker.Clear();
                    rejected = ex;
                }
            }
            await gate.Commit(settle);
        }
        if (rejected is not null)
        {
            await FailImport(importId, rejected.Message, leaseId, "import_failed",
                (rejected as ImportVerificationException)?.Issue);
            throw rejected;
        }
        return await Get(importId, ct);
    }

    private async Task ApplyOutline(AiImport import, AiOutlineResult result, List<ImportPageText> pages, CancellationToken ct)
    {
        var sourceEvidence = ImportOutlineEvidence.Read(pages);
        import.Model = result.Model; import.InputTokens += result.InputTokens; import.CachedInputTokens += result.CachedInputTokens; import.OutputTokens += result.OutputTokens;
        import.Error = "";
        if (result.LegacyProgram is { } legacy)
        {
            var sourceText = ImportSourceText.Slice(pages, 1, ImportSourceText.MaxPages);
            var reconciledLegacy = ImportTableEvidence.Enrich(legacy, sourceText);
            var labeled = ImportDayLabels.Apply(await ToDraft(reconciledLegacy, ct), pages);
            var routine = ImportWarmupRoutine.LeaveOut(labeled.Draft.Workouts, pages);
            var versions = ImportWeekVariants.Separate(routine.Workouts, pages);
            var draft = ImportOutlineEvidence.NormalizeDraft(labeled.Draft with { Workouts = versions.Workouts }, sourceEvidence);
            var blockRuns = ImportBlockRuns.Reconcile(draft.Workouts);
            draft = draft with { Workouts = blockRuns.Workouts };
            var named = ImportDayLabels.FillMissing(draft);
            draft = named.Draft;
            var numbered = NormalizePhaseWeeks(draft.Workouts);
            if (numbered.Renumbered) draft = draft with { Workouts = numbered.Workouts };
            var longWeeks = ImportLongWeeks.Reconcile(draft.Workouts, pages);
            draft = draft with { Workouts = longWeeks.Workouts, SourceWeekDays = longWeeks.SourceWeekDays };
            var scheduleNotices = new List<ImportReviewIssue>();
            draft = ApplyPrintedSchedule(draft, pages, scheduleNotices);
            // A whole-program answer holds the same days as a sectioned one and needs the same
            // reconciliation; it simply has no chunk to attribute a notice to.
            var shaped = ReconcileDayShape(draft.Workouts, draft.SourceWeekDays);
            var cited = ImportDayShape.ReconcilePages(draft with { Workouts = shaped.Workouts }, import.Pages);
            List<ImportPageLink> demoLinks = string.IsNullOrWhiteSpace(import.LinksJson) ? [] : Json.Read<List<ImportPageLink>>(import.LinksJson);
            draft = ImportValidation.NormalizeDraft(ImportDemoLinks.Attach(ImportNameSpelling.Standardize(cited.Draft, pages), demoLinks));
            if (ImportTableEvidence.PrintedRowsNotice(draft.Workouts, sourceText) is { } printedRows) cited.Notices.Add(printedRows);
            List<ImportReviewIssue> outlineNotices = [.. labeled.Notices, .. routine.Notices, .. versions.Notices, .. blockRuns.Notices, .. named.Notices, .. longWeeks.Notices, .. scheduleNotices];
            if (numbered.Renumbered)
            {
                outlineNotices.Add(new ImportReviewIssue("phase_week_renumbered",
                    "Some phases continued the block's week numbering, so their weeks were numbered from one within each phase. The weeks themselves are unchanged.",
                    "info", null));
            }
            outlineNotices.AddRange(shaped.Notices);
            outlineNotices.AddRange(cited.Notices);
            outlineNotices.AddRange(ImportNameEvidence.Unsupported(draft, pages));
            outlineNotices.AddRange(ImportNameEvidence.OverCounted(draft, pages));
            if (outlineNotices.Count > 0)
                import.NoticesJson = Json.Write(ImportReviewNotices.Merge(ReadNotices(import.NoticesJson), outlineNotices));
            await ValidateDraft(draft, ct);
            ValidateDraftPages(draft, import.PageCoverageJson);
            import.DraftJson = Json.Write(draft);
            RequireVerifiedDraft(draft, import, outlineNotices);
            import.ChunksDone = 1; import.ChunksTotal = 1;
            CompleteRead(import, draft, pages);
            return;
        }
        // A complete printed schedule is its own page map: when the outline leaves out pages it prints,
        // its weeks are read section by section instead of the shorter program the outline describes.
        // A schedule printed entirely as clean tables is divided the same way, so every section is
        // read from its tables and none waits on a model read.
        if (result.Outline?.Alternatives is not { Count: > 1 }
            && ImportPrintedSchedule.Read(pages) is { } printed && (!printed.CoveredBy(OutlinedChunks(result.Outline!))
            || ImportTableEvidence.ReadPrintedSection(printed.Days, ImportSourceText.Slice(pages, printed.Days[0].Page, printed.Days[^1].Page)) is not null))
        {
            var sourceChunks = SplitChunks(printed.Chunks());
            ValidateChunkPages(sourceChunks, import.PageCoverageJson);
            import.SelectedAlternativeId = "";
            import.OutlineJson = Json.Write(sourceChunks);
            import.DraftJson = Json.Write(new ImportDraft(ProgramTitle(ImportProgramTitle.Grounded(result.Outline?.ProgramTitle, pages), import.FileName), []));
            import.Stage = "extract"; import.Status = ImportStatus.Pending;
            import.ChunksDone = 0; import.ChunksTotal = sourceChunks.Count;
            import.UnresolvedCount = 0;
            return;
        }
        // Exercise matching is local and happens after each chunk is parsed. The catalog is
        // deliberately absent from outline/extraction requests so a long library cannot consume
        // context tokens or bias the transcription toward a near match.
        var reconciled = ImportAlternativeReconciliation.Reconcile(result.Outline!, pages);
        if (reconciled.Notices.Count > 0)
            import.NoticesJson = Json.Write(ImportReviewNotices.Merge(ReadNotices(import.NoticesJson), reconciled.Notices));
        var alternatives = reconciled.Alternatives;
        if (alternatives.Count > 1)
        {
            import.AlternativesJson = Json.Write(alternatives.Select(alternative =>
            {
                var chunks = ImportOutlineEvidence.NormalizeChunks(alternative.Chunks, sourceEvidence);
                var runs = ImportBlockRuns.ReconcileChunks(ImportPageTemplateWeeks.Reconcile(chunks, pages));
                var absolute = ImportAbsoluteWeeks.NormalizeChunks(runs.Chunks, sourceEvidence);
                var (weekCount, sessionsPerWeek) = ImportPrintedSchedule.DescribeAlternative(absolute.Chunks, pages);
                return new ImportAlternative(alternative.Id,
                    ImportNormalization.Label(alternative.Name, 200, alternative.Id), absolute.Chunks.Count,
                    absolute.Chunks.Sum(chunk => chunk.DayCount), absolute.Chunks, weekCount, sessionsPerWeek);
            }).ToList());
            import.Stage = "select"; import.Status = ImportStatus.Pending; import.ChunksDone = 0; import.ChunksTotal = 0;
            import.DraftJson = Json.Write(new ImportDraft(ProgramTitle(ImportProgramTitle.Grounded(result.Outline!.ProgramTitle, pages), import.FileName), []));
            return;
        }
        var selected = alternatives.Count == 1 ? alternatives[0] : null;
        var normalizedChunks = ImportOutlineEvidence.NormalizeChunks(selected?.Chunks ?? reconciled.Chunks, sourceEvidence);
        var runs = ImportBlockRuns.ReconcileChunks(ImportPageTemplateWeeks.Reconcile(normalizedChunks, pages));
        var absolute = ImportAbsoluteWeeks.NormalizeChunks(runs.Chunks, sourceEvidence);
        var combinedNotices = runs.Notices.Concat(absolute.Notices).ToList();
        if (combinedNotices.Count > 0)
            import.NoticesJson = Json.Write(ImportReviewNotices.Merge(ReadNotices(import.NoticesJson), combinedNotices));
        var chunks = SplitChunks(absolute.Chunks);
        ValidateChunkPages(chunks, import.PageCoverageJson);
        import.SelectedAlternativeId = selected?.Id ?? "";
        import.OutlineJson = Json.Write(chunks);
        import.DraftJson = Json.Write(new ImportDraft(ProgramTitle(selected?.Name ?? ImportProgramTitle.Grounded(result.Outline!.ProgramTitle, pages), import.FileName), []));
        import.Stage = "extract"; import.Status = ImportStatus.Pending; import.ChunksDone = 0; import.ChunksTotal = chunks.Count;
        import.UnresolvedCount = 0;
    }

    public async Task<ImportView> SelectAlternative(Guid id, string alternativeId, CancellationToken ct)
    {
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            Validation.Require(import!.Status == ImportStatus.Pending && import.Stage == "select", "This import is not waiting for an alternative selection.", 409);
            var alternatives = string.IsNullOrWhiteSpace(import.AlternativesJson) ? [] : Json.Read<List<ImportAlternative>>(import.AlternativesJson);
            var selected = alternatives.SingleOrDefault(a => string.Equals(a.Id, alternativeId, StringComparison.OrdinalIgnoreCase));
            Validation.Require(selected is not null, "That alternative is no longer available. Read the outline again.", 409);
            if (selected!.Kind == ImportAlternativeKinds.Week)
            {
                // The program is already read; the choice only decides which version's days stay.
                ChooseWeekVersion(import, selected, alternatives);
                import.Revision++;
                await db.SaveChangesAsync(ct); await gate.Commit(ct);
                db.ChangeTracker.Clear();
                return await Get(id, ct);
            }
            Validation.Require(import.PromptVersion == WorkoutAi.PromptVersion,
                "This PDF outline was created by an older importer. Upload the PDF again to continue with the updated reader.", 409);
            var runs = ImportBlockRuns.ReconcileChunks(selected!.Chunks ?? []);
            var absolute = ImportAbsoluteWeeks.NormalizeChunks(runs.Chunks);
            var combinedNotices = runs.Notices.Concat(absolute.Notices).ToList();
            if (combinedNotices.Count > 0)
                import.NoticesJson = Json.Write(ImportReviewNotices.Merge(ReadNotices(import.NoticesJson), combinedNotices));
            var chunks = SplitChunks(absolute.Chunks);
            ValidateChunkPages(chunks, import.PageCoverageJson);
            import.SelectedAlternativeId = selected.Id; import.OutlineJson = Json.Write(chunks);
            import.DraftJson = Json.Write(new ImportDraft(ProgramTitle(selected.Name, import.FileName), []));
            import.Stage = "extract"; import.ChunksDone = 0; import.ChunksTotal = chunks.Count; import.Revision++;
            await db.SaveChangesAsync(ct); await gate.Commit(ct);
        }
        db.ChangeTracker.Clear();
        return await Get(id, ct);
    }

    private static IEnumerable<AiOutlineChunk> OutlinedChunks(AiOutline outline)
        => outline.Chunks.Concat(outline.Alternatives?.SelectMany(alternative => alternative.Chunks) ?? []);

    /// A program always has something to call itself on the review screen; the document's own
    /// file name is a better stand-in than a blank field when the model returns no title.
    private static string ProgramTitle(string? title, string fileName)
        => ImportNormalization.Label(title, 120, Path.GetFileNameWithoutExtension(fileName) is { Length: > 0 } name ? name : "Imported program");

}
