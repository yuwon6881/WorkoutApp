using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService(AppDb db, WorkoutAi ai, CatalogService catalog, ProgramService programs, IImportFileStore files, IImportJobDispatcher? jobs = null, IConfiguration? config = null)
{
    // The original public constructor remains available to direct callers while the app container
    // supplies the configured GCS or transient store through the primary constructor.
    public ImportService(AppDb db, WorkoutAi ai, CatalogService catalog, ProgramService programs)
        : this(db, ai, catalog, programs, new TransientImportFileStore(new ConfigurationBuilder().Build()), null, new ConfigurationBuilder().Build())
    {
    }

    /// Only work still in progress. A finished import is deleted rather than kept, so there is no
    /// import history to list: the program it produced is the lasting record.
    public async Task<List<ImportView>> List(CancellationToken ct)
    {
        var rows = await db.Imports.AsNoTracking()
            .Where(i => i.Status == ImportStatus.Pending || i.Status == ImportStatus.Ready)
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

    public static List<UnresolvedExercise> Unresolved(ImportDraft draft) => ImportValidation.Unresolved(draft);

    private static List<ImportReviewIssue> ReviewIssues(ImportDraft draft) => ImportValidation.ReviewIssues(draft);

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
        // An import is working state, not history. Once its program exists the row has nothing
        // left to say, so it is removed rather than kept as a record of what was imported.
        db.Imports.Remove(import);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await programs.Get(program.Id, ct);
    }

    public async Task Discard(Guid id, CancellationToken ct)
    {
        string release;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            release = TakeSource(import!);
            db.Imports.Remove(import!);
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        await DeleteQuietly(release, ct);
    }

    public async Task CleanupExpired(CancellationToken ct)
    {
        var previousMaintenance = db.MaintenanceAccess;
        db.MaintenanceAccess = true;
        try
        {
        var now = DateTime.UtcNow;
        // Keys are released in the database first and the objects are removed after the commit:
        // an object deleted ahead of a rolled-back sweep would leave a live import pointing at
        // bytes that are gone.
        var release = new List<string>();
        var expired = await db.Imports.IgnoreQueryFilters().Where(i => i.SourceFileExpiresAt != null && i.SourceFileExpiresAt < now && i.SourceFileKey != "").ToListAsync(ct);
        foreach (var import in expired)
        {
            release.Add(TakeSource(import));
            // An unfinished import whose source expired can never be completed, and there is no
            // history to preserve it in.
            if (import.Status == ImportStatus.Pending) db.Imports.Remove(import);
        }
        var uploads = await db.ImportUploads.IgnoreQueryFilters().Where(x => x.ExpiresAt < now).ToListAsync(ct);
        foreach (var upload in uploads)
        {
            release.Add(upload.SourceFileKey);
            db.ImportUploads.Remove(upload);
        }

        if (expired.Count > 0 || uploads.Count > 0) await db.SaveChangesAsync(ct);
        foreach (var key in release) await DeleteQuietly(key, ct);

        // Only unfinished imports exist now, so an abandoned one is removed outright rather than
        // blanked in place. Nothing here may grow without bound.
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

    public Task ValidateDraft(ImportDraft draft, CancellationToken ct) => ImportValidation.ValidateDraft(draft, catalog, ct);

    private Task ValidateWorkout(DraftWorkout workout, CancellationToken ct) => ImportValidation.ValidateWorkout(workout, catalog, ct);

    private static SetPrescription ToPrescription(DraftSet set) => ImportValidation.ToPrescription(set);

    private static List<ImportChunk> SplitChunks(List<AiOutlineChunk> source) => ImportValidation.SplitChunks(source);

    private static List<ImportChunk> SplitChunks(List<ImportChunk> source) => ImportValidation.SplitChunks(source);

    private static List<ImportChunk> ReadChunks(string json) => ImportValidation.ReadChunks(json);

    private static void ValidateChunkCoverage(ImportDraft existing, ImportDraft extracted, ImportChunk chunk)
        => ImportValidation.ValidateChunkCoverage(existing, extracted, chunk);

    private void UpdateCounters(AiImport import, ImportDraft draft)
    {
        var unresolved = Unresolved(draft);
        import.UnresolvedCount = unresolved.Count;
        import.CatalogStale = draft.Workouts.SelectMany(w => w.Exercises).Any(e => e.ExerciseId is null ? false : !db.Exercises.Any(x => x.Id == e.ExerciseId && x.Active));
    }

    private static void ValidatePdf(byte[] pdf, string fileName) => ImportValidation.ValidatePdf(pdf, fileName);

    private static void ValidateChunkPages(IEnumerable<ImportChunk> chunks, string coverageJson)
        => ImportValidation.ValidateChunkPages(chunks, coverageJson);

    private static void ValidateDraftPages(ImportDraft draft, string coverageJson)
        => ImportValidation.ValidateDraftPages(draft, coverageJson);

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
