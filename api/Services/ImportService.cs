using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService(AppDb db, CatalogService catalog, ProgramService programs,
    IConfiguration? config = null)
{
    /// Only work still in progress. A finished import is deleted rather than kept, so there is no
    /// import history to list: the program it produced is the lasting record.
    public async Task<List<ImportView>> List(CancellationToken ct)
    {
        var rows = await db.Imports.AsNoTracking()
            .Where(i => i.Status == ImportStatus.Pending || i.Status == ImportStatus.Ready)
            .OrderByDescending(i => i.Created).Take(10).ToListAsync(ct);
        var views = new List<ImportView>();
        // The listing reads the RIR preference once for all of its imports.
        bool? tracksRir = null;
        foreach (var row in rows) views.Add(await View(row, includeDraft: false, ct, async () => tracksRir ??= await TracksRir(ct)));
        return views;
    }

    public async Task<ImportView> Get(Guid id, CancellationToken ct)
    {
        var import = await db.Imports.AsNoTracking().SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        return await View(import!, includeDraft: true, ct);
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
        var targetKey = ImportValidation.MappingKey(target.workout, target.exercise!.SourceName, target.exercise.LineId);
        var next = draft with
        {
            Workouts = draft.Workouts.Select(workout => workout with
            {
                Exercises = workout.Exercises.Select(exercise =>
                    ImportValidation.MappingKey(workout, exercise.SourceName, exercise.LineId).Equals(targetKey, StringComparison.Ordinal)
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

    private async Task<ImportView> View(AiImport import, bool includeDraft, CancellationToken ct, Func<Task<bool>>? tracksRir = null)
    {
        ImportDraft? draft = null;
        var unresolved = new List<UnresolvedExercise>();
        if (includeDraft && !string.IsNullOrEmpty(import.DraftJson))
        {
            draft = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(import.DraftJson));
            unresolved = Unresolved(draft);
        }
        var unresolvedCount = includeDraft ? unresolved.Count : import.UnresolvedCount;
        var edits = import.Status == ImportStatus.Ready ? ImportReviewEdits.Compare(import.DraftBaselineJson, draft) : ImportReviewEdits.None;
        var issues = includeDraft && draft is not null ? ImportValidation.ReviewIssues(draft, edits) : [];
        // Reading notes are recorded as the import runs and are as much a part of the review as
        // the issues derived from the draft, so both reach the panel through one list.
        issues = [.. FilterNotices(ReadNotices(import.NoticesJson), draft, edits), .. issues,
            .. (draft is null ? [] : ImportUncertaintyReview.Issues(draft))];
        issues = issues.Distinct().ToList();
        if (import.PromptVersion == ImportDraftAlternatives.ExternalPromptVersion)
            issues = issues.Select(ExternalReviewWording.Apply).ToList();
        if (issues.Count > 0) issues = ImportReviewPolicy.ForReview(issues, await (tracksRir?.Invoke() ?? TracksRir(ct)));
        var alternatives = string.IsNullOrWhiteSpace(import.AlternativesJson) ? [] : Json.Read<List<ImportAlternative>>(import.AlternativesJson);
        var acceptable = import.Status == ImportStatus.Ready && unresolved.Count == 0 && issues.All(i => i.Severity == "info");
        var (canRestoreDraft, restorableExerciseLineIds) = AnalyzeRestorability(import, draft);
        return new ImportView(import.Id, import.Status, import.FileName, import.Pages, import.Error, import.Created, import.Model,
            import.Stage, unresolvedCount, draft, unresolved, acceptable, import.ProgramId, issues,
            alternatives, import.SelectedAlternativeId, import.Revision, canRestoreDraft, restorableExerciseLineIds);
    }

    public static List<UnresolvedExercise> Unresolved(ImportDraft draft) => ImportValidation.Unresolved(draft);

    private Task<bool> TracksRir(CancellationToken ct)
        => db.Users.AsNoTracking().Where(u => u.Id == db.CurrentUser).Select(u => u.TrackRir).SingleAsync(ct);

    private async Task<ImportView> SaveDraft(Guid id, ImportDraft draft, int? revision, CancellationToken ct)
    {
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        TemplateService.RequireFresh(revision, import.Revision);
        if (string.IsNullOrEmpty(import.DraftBaselineJson)) import.DraftBaselineJson = import.DraftJson;
        // Numbered per program version, the way validation judges it: versions of one program share week numbers.
        var normalizedDraft = ImportValidation.NormalizeDraft(ImportValidation.NumberPhaseWeeks(draft));
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
        Validation.Require(day.LineId == lineId, "That day does not match the requested draft line.", 400);
        return await EditDays(id, [day], revision, ct);
    }

    /// Replaces the named days and keeps every other day as stored. An exercise edit that reaches
    /// several occurrences sends only the days it changed, so the request and its validation scale
    /// with the edit rather than with the whole program.
    public async Task<ImportView> EditDays(Guid id, IReadOnlyList<DraftWorkout> days, int? revision, CancellationToken ct)
    {
        Validation.Require(days.Count > 0, "Choose at least one day to save.", 400);
        Validation.Require(days.Select(day => day.LineId).Distinct().Count() == days.Count, "Each day can be saved only once per request.", 400);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        TemplateService.RequireFresh(revision, import.Revision);
        var draft = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(import.DraftJson));
        var stored = draft.Workouts.Select(w => w.LineId).ToHashSet();
        Validation.Require(days.All(day => stored.Contains(day.LineId)), "That day no longer exists.", 404);
        foreach (var day in days) await ValidateWorkout(day, ct);
        if (string.IsNullOrEmpty(import.DraftBaselineJson)) import.DraftBaselineJson = import.DraftJson;
        var replacements = days.ToDictionary(day => day.LineId);
        var next = ImportValidation.NormalizeDraft(draft with
        {
            Workouts = draft.Workouts.Select(w => replacements.GetValueOrDefault(w.LineId, w)).ToList()
        });
        import.DraftJson = Json.Write(next); import.Revision++; UpdateCounters(import, next);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    /// Acceptance is all-or-nothing: the review must have no unresolved mappings or document issues.
    public async Task<ProgramView> Accept(Guid id, CancellationToken ct, int? revision = null, bool acknowledgeUncertainty = false)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import has already been accepted or discarded.", 409);
        TemplateService.RequireFresh(revision, import.Revision);
        var draft = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(import.DraftJson));
        var hasUncertainty = ImportUncertaintyReview.Issues(draft).Count > 0;
        Validation.Require(!hasUncertainty || revision is not null,
            "Reload and review the current draft before acknowledging uncertain details.", 409);
        Validation.Require(acknowledgeUncertainty || !hasUncertainty,
            "Review and acknowledge the uncertain import details before creating this program.", 409);
        await ValidateDraft(draft, ct);
        var unresolved = Unresolved(draft);
        var edits = ImportReviewEdits.Compare(import.DraftBaselineJson, draft);
        List<ImportReviewIssue> issues = [.. FilterNotices(ReadNotices(import.NoticesJson), draft, edits),
            .. ImportValidation.ReviewIssues(draft, edits)];
        var actionable = ImportReviewPolicy.ForReview(issues, await TracksRir(ct)).Where(i => i.Severity != "info").ToList();
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
        var external = import.PromptVersion == ImportDraftAlternatives.ExternalPromptVersion;
        var program = await programs.Materialize(input, activate: false, sourceImportId: external ? null : import.Id, ct);
        program.AllowUnspecifiedEffort = external;
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
        // A draft still waiting for a version choice after a day has been abandoned.
        var pendingCutoff = now.AddDays(-1);
        await db.Imports.IgnoreQueryFilters()
            .Where(i => i.Status == ImportStatus.Pending && i.Created < pendingCutoff)
            .ExecuteDeleteAsync(ct);

        // Only unfinished imports exist beyond acceptance, so an abandoned one is removed outright
        // rather than blanked in place. Nothing here may grow without bound.
        var importDays = Math.Max(1, config?.GetValue("Retention:ImportDays", 30) ?? 30);
        var importCutoff = now.AddDays(-importDays);
        await db.Imports.IgnoreQueryFilters().Where(i => i.Created < importCutoff).ExecuteDeleteAsync(ct);

        await db.Sessions.Where(s => s.Expires < now).ExecuteDeleteAsync(ct);
        // A consent the user never returned from is otherwise never consumed, and pairing only
        // tidies up after itself when somebody pairs again.
        await db.GoogleHealthOAuthStates.IgnoreQueryFilters().Where(s => s.ExpiresAt < now).ExecuteDeleteAsync(ct);
        await db.WatchPairings.IgnoreQueryFilters().Where(pairing =>
                (pairing.ApprovedAt == null && pairing.ExpiresAt <= now) ||
                (pairing.ApprovedAt != null && pairing.ApprovedAt < now.AddDays(-7)))
            .ExecuteDeleteAsync(ct);
        await db.WatchDevices.IgnoreQueryFilters().Where(device => device.RevokedAt != null || device.ExpiresAt <= now)
            .ExecuteDeleteAsync(ct);

        var receiptDays = Math.Max(1, config?.GetValue("Retention:ReceiptDays", 90) ?? 90);
        var receiptCutoff = now.AddDays(-receiptDays);
        await db.Receipts.IgnoreQueryFilters().Where(r => r.Created < receiptCutoff).ExecuteDeleteAsync(ct);

        var aiTurnCutoff = now.AddDays(-Math.Max(1, config?.GetValue("Retention:AiTurnRetentionDays", 90) ?? 90));
        var pendingCutoffAi = now.AddMinutes(-10);
        await db.AiConversationTurns.IgnoreQueryFilters()
            .Where(t => t.CreatedAt < aiTurnCutoff || (t.Status == "Pending" && t.CreatedAt < pendingCutoffAi))
            .ExecuteDeleteAsync(ct);
        var aiUsageMonths = Math.Max(1, config?.GetValue("Retention:AiUsageMonths", 2) ?? 2);
        var usageCutoff = DateOnly.FromDateTime(now.AddMonths(-aiUsageMonths));
        await db.Usage.IgnoreQueryFilters().Where(u => u.Date < usageCutoff).ExecuteDeleteAsync(ct);
        }
        finally { db.MaintenanceAccess = previousMaintenance; }
    }

}
