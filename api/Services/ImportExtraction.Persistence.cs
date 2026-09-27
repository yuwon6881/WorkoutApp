using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    /// Runs the synchronous extraction path from an owned background scope. HTTP callers use the
    /// runner, while direct callers and tests can still await Extract deterministically.
    public async Task RunExtract(Guid id, CancellationToken ct)
    {
        try
        {
            await Extract(id, ct);
        }
        catch (DomainException ex)
        {
            await RecordBackgroundFailure(id, ex.Message);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            await RecordBackgroundFailure(id, "That extraction did not finish. Try again.");
        }
    }
    /// A section waiting to be read. Printed holds only complete, locally verified day groups;
    /// PrintedPages records their exclusive ownership when the model handles the remaining pages.
    private sealed record PendingChunk(int Index, ImportChunk Chunk, string Text, AiProgram? Printed = null,
        HashSet<int>? PrintedPages = null);

    private static AiProgram MergePrintedPages(AiProgram model, AiProgram? printed, IReadOnlySet<int>? printedPages)
    {
        if (printed?.Days is not { } printedDays || printedPages is not { Count: > 0 }) return model;
        var modelDays = (model.Days ?? []).Where(day =>
        {
            var page = day.SourcePage ?? UniqueSourcePage(day.Exercises);
            return page is null || !printedPages.Contains(page.Value);
        }).ToList();
        var ordered = modelDays.Concat(printedDays)
            .Select((day, index) => (Day: day, Index: index, Page: day.SourcePage ?? UniqueSourcePage(day.Exercises)))
            .OrderBy(item => item.Page ?? int.MaxValue).ThenBy(item => item.Index)
            .Select(item => item.Day).ToList();
        return model with { Days = ordered, Weeks = null };
    }

    private static AiProgram ReplacePageScope(AiProgram original, AiProgram replacement, IReadOnlySet<int> pages)
    {
        if (original.Days is not { } originalDays || replacement.Days is not { } replacementDays) return original;
        var corrected = new List<AiDay>();
        foreach (var day in replacementDays)
        {
            var page = day.SourcePage ?? UniqueSourcePage(day.Exercises);
            if (page is null && pages.Count == 1) page = pages.Single();
            if (page is { } sourcePage && pages.Contains(sourcePage))
                corrected.Add(day with { SourcePage = sourcePage });
        }
        var retained = originalDays.Where(day =>
        {
            var page = day.SourcePage ?? UniqueSourcePage(day.Exercises);
            return page is null || !pages.Contains(page.Value);
        });
        var ordered = retained.Concat(corrected)
            .Select((day, index) => (Day: day, Index: index, Page: day.SourcePage ?? UniqueSourcePage(day.Exercises)))
            .OrderBy(item => item.Page ?? int.MaxValue).ThenBy(item => item.Index)
            .Select(item => item.Day).ToList();
        return original with { Days = ordered, Weeks = null };
    }

    private static int? UniqueSourcePage(IReadOnlyList<AiExercise> exercises)
    {
        var pages = exercises.SelectMany(exercise => new int?[] { exercise.SourcePage }
                .Concat(exercise.Sets.Select(set => set.SourcePage)))
            .Where(page => page.HasValue).Select(page => page!.Value).Distinct().Take(2).ToList();
        return pages.Count == 1 ? pages[0] : null;
    }

    /// The model name a section read from its printed tables records in place of a provider model.
    private const string PrintedTableReader = "printed-tables";

    /// Retry is an explicit idempotent operation for a pending import; the stored text is reused
    /// while it is inside its retention window.
    public Task<ImportView> Retry(Guid id, CancellationToken ct) => Extract(id, ct);

    private static void AdvanceChunk(AiImport import, int chunkIndex, IReadOnlyList<ImportReviewIssue> recorded)
    {
        import.ChunksDone = chunkIndex + 1; import.Error = ""; import.Revision++;
        if (recorded.Count == 0) return;
        var notices = ImportReviewNotices.Merge(ReadNotices(import.NoticesJson), recorded);
        import.NoticesJson = Json.Write(notices);
    }

    private static List<ImportPageText> SourcePages(AiImport import)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(import.SourceTextJson),
            "The text read from this PDF is no longer available.", 410);
        return Json.Read<List<ImportPageText>>(import.SourceTextJson);
    }

    /// The extracted text exists only to finish the read. Once the draft is complete it has
    /// nothing left to say and is dropped rather than kept next to the draft it produced.
    private static void ClearSource(AiImport import)
    {
        import.SourceTextJson = ""; import.LinksJson = ""; import.SourceExpiresAt = null; import.ChunkResultsJson = "";
        import.WorkStateJson = "";
    }

    private static Dictionary<int, AiImportResult> ReadChunkResults(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return Json.Read<Dictionary<int, AiImportResult>>(json); }
        catch (JsonException) { return []; }
        catch (DomainException) { return []; }
    }

    private async Task FailImport(Guid importId, string message, string? leaseId = null, string code = "import_failed",
        ImportReviewIssue? terminalIssue = null)
    {
        var settle = CancellationToken.None;
        db.ChangeTracker.Clear();
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, settle);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
        if (import is null || import.Status != ImportStatus.Pending || (leaseId is not null && !OwnsLease(import, leaseId))) { await gate.Commit(settle); return; }
        // Keep the terminal explanation available to the polling UI, but clear document text and
        // intermediate model responses at the terminal boundary.
        import.Status = ImportStatus.Failed;
        // The import stage is constrained to the reader's persisted stages. Status carries the
        // terminal failure state; keeping the last reader stage lets existing clients continue
        // rendering their stage-specific progress and review data.
        import.Stage = "failed";
        import.Error = message;
        import.NoticesJson = Json.Write(ImportReviewNotices.Merge(ReadNotices(import.NoticesJson),
            [terminalIssue ?? new ImportReviewIssue(code, message, "warning")]));
        ClearSource(import);
        ReleaseLease(import);
        import.Revision++;
        await db.SaveChangesAsync(settle);
        await gate.Commit(settle);
    }

    /// Records a failure the same import can still recover from. The stored text stays, so the
    /// next attempt costs one model call rather than another read of the document.
    private async Task RecordRetryableFailure(Guid importId, string message, string? leaseId = null)
    {
        var settle = CancellationToken.None;
        db.ChangeTracker.Clear();
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, settle);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
        if (import is null || import.Status != ImportStatus.Pending || (leaseId is not null && !OwnsLease(import, leaseId))) { await gate.Commit(settle); return; }
        import.Error = message; import.Retries++; import.Revision++; ReleaseLease(import);
        await db.SaveChangesAsync(settle);
        await gate.Commit(settle);
    }

    private async Task RecordBackgroundFailure(Guid importId, string message)
    {
        var settle = CancellationToken.None;
        db.ChangeTracker.Clear();
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, settle);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == importId, settle);
        if (import is not null && import.Status == ImportStatus.Pending && string.IsNullOrWhiteSpace(import.Error))
        {
            import.Error = message; import.Retries++; import.Revision++;
            await db.SaveChangesAsync(settle);
        }
        await gate.Commit(settle);
    }

    /// The daily read budget. Every model call an import makes is metered, including retries.
    private async Task Meter(AiImport import, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var usage = await db.Usage.SingleOrDefaultAsync(u => u.Date == today, ct);
        if (usage == null) { usage = new AiUsage { UserId = db.CurrentUser!.Value, Date = today, Count = 0 }; db.Usage.Add(usage); }
        Validation.Require(usage.Count < DailyLimit, $"You have used all {DailyLimit} AI reads for today. Manual program building remains available.", 429);
        usage.Count++; import.Calls++;
        await db.SaveChangesAsync(ct);
    }
}
