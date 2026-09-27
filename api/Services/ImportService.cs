using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService(AppDb db, WorkoutAi ai, CatalogService catalog, ProgramService programs,
    IConfiguration? config = null, ILogger<ImportService>? logger = null)
{
    private readonly SemaphoreSlim importCatalogGate = new(1, 1);
    private ImportCatalogSnapshot? importCatalogSnapshot;

    private sealed record ImportCatalogSnapshot(HashSet<Guid> Active, Dictionary<string, Guid> Matches,
        Dictionary<Guid, string> Names);

    /// Only work still in progress. A finished import is deleted rather than kept, so there is no
    /// import history to list: the program it produced is the lasting record.
    public async Task<List<ImportView>> List(CancellationToken ct)
    {
        var rows = await db.Imports.AsNoTracking()
            .Where(i => i.Status == ImportStatus.Pending || i.Status == ImportStatus.Ready || i.Status == ImportStatus.Failed)
            .OrderByDescending(i => i.Created).Take(10).ToListAsync(ct);
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

    public async Task<ImportStatusView> GetStatus(Guid id, CancellationToken ct)
    {
        var import = await db.Imports.AsNoTracking().SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        var chunks = ReadChunks(import!.OutlineJson);
        var state = ImportWorkState.Read(import.WorkStateJson);
        var candidateKeys = state.RecoveryCandidates is { } candidates ? candidates.Keys : Enumerable.Empty<int>();
        var saved = ReadChunkResults(import.ChunkResultsJson).Keys.Concat(candidateKeys).Distinct().Count();
        var done = import.ChunksDone;
        var progress = import.Status == ImportStatus.Pending ? state.Progress(import.ChunksTotal, done, Math.Max(done, saved)) : null;
        return new ImportStatusView(import.Id, import.Status, import.Stage, done, import.ChunksTotal,
            chunks.ElementAtOrDefault(done)?.Label ?? chunks.ElementAtOrDefault(import.ChunksDone)?.Label, import.Error, import.Revision, import.Retries,
            import.UnresolvedCount, progress);
    }

    public async Task<ImportView> MapSlot(Guid id, Guid exerciseLineId, Guid? replacementExerciseId, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        TemplateService.RequireFresh(revision, import.Revision);
        var draft = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(import.DraftJson));
        var target = draft.Workouts.SelectMany(workout => workout.Exercises.Select((exercise, position) => (workout, exercise, position)))
            .FirstOrDefault(item => item.exercise.LineId == exerciseLineId);
        Validation.Require(target.exercise is not null, "That exercise slot no longer exists.", 404);
        await catalog.RequireActive(replacementExerciseId, ct);
        // One mapping links every occurrence the review listed under it.
        var targetKey = ImportValidation.MappingKey(target.workout, target.exercise!.SourceName);
        var next = draft with
        {
            Workouts = draft.Workouts.Select(workout => workout with
            {
                Exercises = workout.Exercises.Select(exercise =>
                    ImportValidation.MappingKey(workout, exercise.SourceName).Equals(targetKey, StringComparison.Ordinal)
                        ? exercise with { ExerciseId = replacementExerciseId }
                        : exercise).ToList()
            }).ToList()
        };
        await ValidateDraft(next, ct);
        import.DraftJson = Json.Write(next); import.Revision++; UpdateCounters(import, next);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    private async Task<ImportView> View(AiImport import, bool includeDraft, CancellationToken ct)
    {
        ImportDraft? draft = null;
        var unresolved = new List<UnresolvedExercise>();
        if (includeDraft && !string.IsNullOrEmpty(import.DraftJson))
        {
            draft = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(import.DraftJson));
            unresolved = Unresolved(draft);
        }
        var chunks = ReadChunks(import.OutlineJson);
        var unresolvedCount = includeDraft ? unresolved.Count : import.UnresolvedCount;
        var issues = includeDraft && draft is not null ? ReviewIssues(draft) : [];
        // Reading notes are recorded as the import runs and are as much a part of the review as
        // the issues derived from the draft, so both reach the panel through one list.
        issues = [.. FilterNotices(ReadNotices(import.NoticesJson), draft), .. issues];
        issues = issues.Distinct().ToList();
        var coverage = string.IsNullOrWhiteSpace(import.PageCoverageJson) ? [] : Json.Read<List<PdfPageCoverage>>(import.PageCoverageJson);
        var alternatives = string.IsNullOrWhiteSpace(import.AlternativesJson) ? [] : Json.Read<List<ImportAlternative>>(import.AlternativesJson);
        var acceptable = import.Status == ImportStatus.Ready && unresolved.Count == 0 && issues.All(i => i.Severity == "info");
        var (canRestoreDraft, restorableExerciseLineIds) = AnalyzeRestorability(import, draft);
        var state = ImportWorkState.Read(import.WorkStateJson);
        var candidateKeys = state.RecoveryCandidates is { } candidates ? candidates.Keys : Enumerable.Empty<int>();
        var saved = ReadChunkResults(import.ChunkResultsJson).Keys.Concat(candidateKeys).Distinct().Count();
        var done = import.ChunksDone;
        return new ImportView(import.Id, import.Status, import.FileName, import.Pages, import.Error, import.Created, import.Model,
            import.Stage, done, import.ChunksTotal, chunks.ElementAtOrDefault(done)?.Label ?? chunks.ElementAtOrDefault(import.ChunksDone)?.Label, unresolvedCount, draft,
            unresolved, acceptable, import.ProgramId, issues,
            import.InputTokens, import.OutputTokens, import.Retries, coverage, alternatives, import.SelectedAlternativeId,
            import.Revision, canRestoreDraft, restorableExerciseLineIds,
            import.Status == ImportStatus.Pending ? state.Progress(import.ChunksTotal, done, Math.Max(done, saved)) : null);
    }

    public static List<UnresolvedExercise> Unresolved(ImportDraft draft) => ImportValidation.Unresolved(draft);

    private static List<ImportReviewIssue> ReviewIssues(ImportDraft draft) => ImportValidation.ReviewIssues(draft);

    private async Task<ImportView> SaveDraft(Guid id, ImportDraft draft, int? revision, CancellationToken ct)
    {
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        TemplateService.RequireFresh(revision, import.Revision);
        if (string.IsNullOrEmpty(import.DraftBaselineJson)) import.DraftBaselineJson = import.DraftJson;
        var (normalizedWorkouts, _) = ImportValidation.NormalizePhaseWeeks(draft.Workouts);
        var normalizedDraft = ImportValidation.NormalizeDraft(draft with { Workouts = normalizedWorkouts });
        await ValidateDraft(normalizedDraft, ct);
        import.DraftJson = Json.Write(normalizedDraft); import.Revision++; UpdateCounters(import, normalizedDraft);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    public Task<ImportView> Edit(Guid id, ImportDraft draft, CancellationToken ct) => Edit(id, draft, null, ct);

    public async Task<ImportView> Edit(Guid id, ImportDraft draft, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var result = await SaveDraft(id, draft, revision, ct);
        await gate.Commit(ct);
        return result;
    }

    public Task<ImportView> EditMetadata(Guid id, ImportMetadata metadata, CancellationToken ct) => EditMetadata(id, metadata, null, ct);

    public async Task<ImportView> EditMetadata(Guid id, ImportMetadata metadata, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        TemplateService.RequireFresh(revision, import.Revision);
        if (string.IsNullOrEmpty(import.DraftBaselineJson)) import.DraftBaselineJson = import.DraftJson;
        var current = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(import.DraftJson));
        var next = current with { ProgramName = metadata.ProgramName };
        Validation.Name(next.ProgramName, "Program name");
        import.DraftJson = Json.Write(next); import.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    public Task<ImportView> EditDay(Guid id, Guid lineId, DraftWorkout day, CancellationToken ct) => EditDay(id, lineId, day, null, ct);

    public async Task<ImportView> EditDay(Guid id, Guid lineId, DraftWorkout day, int? revision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        Validation.Require(day.LineId == lineId, "That day does not match the requested draft line.", 400);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        TemplateService.RequireFresh(revision, import.Revision);
        if (string.IsNullOrEmpty(import.DraftBaselineJson)) import.DraftBaselineJson = import.DraftJson;
        var draft = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(import.DraftJson));
        Validation.Require(draft.Workouts.Any(w => w.LineId == lineId), "That day no longer exists.", 404);
        await ValidateWorkout(day, ct);
        var next = ImportValidation.NormalizeDraft(draft with { Workouts = draft.Workouts.Select(w => w.LineId == lineId ? day : w).ToList() });
        import.DraftJson = Json.Write(next); import.Revision++; UpdateCounters(import, next);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    /// Acceptance is all-or-nothing: the review must have no unresolved mappings or document issues.
    public async Task<ProgramView> Accept(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import has already been accepted or discarded.", 409);
        var draft = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(import.DraftJson));
        await ValidateDraft(draft, ct);
        ValidateDraftPages(draft, import.PageCoverageJson);
        var unresolved = Unresolved(draft);
        List<ImportReviewIssue> issues = [.. FilterNotices(ReadNotices(import.NoticesJson), draft), .. ReviewIssues(draft)];
        var actionable = issues.Where(i => i.Severity != "info").ToList();
        Validation.Require(unresolved.Count == 0 && actionable.Count == 0,
            "Resolve every exercise mapping and review issue before creating this program.", 409);
        var input = new ProgramInput(draft.ProgramName,
            draft.Workouts.Select(w => new ProgramWorkoutInput(w.Week, w.Name, w.Focus, w.Notes,
                w.Exercises.Select(e => new TemplateExerciseInput(e.ExerciseId, e.SourceName, e.Notes,
                    e.Sets.Select(ToPrescription).ToList(), e.SequenceGroup, e.Substitutions, e.SourcePage, e.SlotKey,
                    e.RestSeconds, e.DemoUrl, e.DemoLinks)).ToList(),
                w.Block, w.Phase, w.PhaseWeek, w.IsRestDay, w.SourcePage)).ToList(), null);
        await programs.Validate(input, ct, allowMissingWorkingRpe: true);
        // Imported drafts always enter Standby. Even a completed PDF must be explicitly
        // activated by the user so a mistaken import never displaces the current program.
        var program = await programs.Materialize(input, activate: false, sourceImportId: import.Id, ct);
        // An import is working state, not history. Once its program exists the row has nothing
        // left to say, so it is removed rather than kept as a record of what was imported.
        db.Imports.Remove(import);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await programs.Get(program.Id, ct);
    }

    public async Task Discard(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        db.Imports.Remove(import!);
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
        // An unfinished import left in pending state can never be completed.
        var pendingCutoff = now.AddDays(-1);
        await db.Imports.IgnoreQueryFilters()
            .Where(i => i.Status == ImportStatus.Pending && i.Created < pendingCutoff &&
                (i.LeaseUntil == null || i.LeaseUntil < now))
            .ExecuteDeleteAsync(ct);
        await db.Imports.IgnoreQueryFilters()
            .Where(i => i.SourceExpiresAt != null && i.SourceExpiresAt < now)
            .ExecuteDeleteAsync(ct);

        // Only unfinished imports exist beyond acceptance, so an abandoned one is removed outright
        // rather than blanked in place. Nothing here may grow without bound.
        var importDays = Math.Max(1, config?.GetValue("Retention:ImportDays", 30) ?? 30);
        var importCutoff = now.AddDays(-importDays);
        await db.Imports.IgnoreQueryFilters().Where(i => i.Created < importCutoff).ExecuteDeleteAsync(ct);

        await db.Sessions.Where(s => s.Expires < now).ExecuteDeleteAsync(ct);

        var receiptDays = Math.Max(1, config?.GetValue("Retention:ReceiptDays", 90) ?? 90);
        var receiptCutoff = now.AddDays(-receiptDays);
        await db.Receipts.IgnoreQueryFilters().Where(r => r.Created < receiptCutoff).ExecuteDeleteAsync(ct);

        var aiUsageMonths = Math.Max(1, config?.GetValue("Retention:AiUsageMonths", 2) ?? 2);
        var usageCutoff = DateOnly.FromDateTime(now.AddMonths(-aiUsageMonths));
        await db.Usage.IgnoreQueryFilters().Where(u => u.Date < usageCutoff).ExecuteDeleteAsync(ct);
        }
        finally { db.MaintenanceAccess = previousMaintenance; }
    }

}
