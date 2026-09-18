using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService(AppDb db, WorkoutAi ai, CatalogService catalog, ProgramService programs, IConfiguration? config = null)
{

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
        // Reading notes are recorded as the import runs and are as much a part of the review as
        // the issues derived from the draft, so both reach the panel through one list.
        issues = [.. ReadNotices(import.NoticesJson), .. issues];
        var coverage = string.IsNullOrWhiteSpace(import.PageCoverageJson) ? [] : Json.Read<List<PdfPageCoverage>>(import.PageCoverageJson);
        var alternatives = string.IsNullOrWhiteSpace(import.AlternativesJson) ? [] : Json.Read<List<ImportAlternative>>(import.AlternativesJson);
        return new ImportView(import.Id, import.Status, import.FileName, import.Pages, import.Error, import.Created, import.Model,
            import.Stage, import.ChunksDone, import.ChunksTotal, chunks.ElementAtOrDefault(import.ChunksDone)?.Label, unresolvedCount, draft,
            // Unmapped names are a review warning, not a reason to discard a faithful import;
            // a catalog id that went inactive is different and still needs rematching.
            unresolved, import.Status == ImportStatus.Ready && !import.CatalogStale, import.ProgramId, issues,
            import.InputTokens, import.OutputTokens, import.Retries, import.SourceExpiresAt, coverage, alternatives, import.SelectedAlternativeId);
    }

    public static List<UnresolvedExercise> Unresolved(ImportDraft draft) => ImportValidation.Unresolved(draft);

    private static List<ImportReviewIssue> ReviewIssues(ImportDraft draft) => ImportValidation.ReviewIssues(draft);

    /// Every id the model proposes is checked against the live catalog here. An id that does not
    /// resolve is dropped to null so the reviewer can keep the written exercise name.
    public async Task<ImportDraft> ToDraft(AiProgram program, CancellationToken ct)
    {
        var active = await catalog.ActiveIds(ct);
        var title = ImportNormalization.Label(program.ProgramTitle ?? program.ProgramName, 120, "Imported program");
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
        return new ImportDraft(title, ImportNormalization.Text(program.Description, 4000), workouts);
    }

    private async Task<DraftWorkout> ToDraftWorkout(string? block, string? phase, int week, int phaseWeek, string name, bool restDay,
        string? notes, List<AiExercise>? sourceExercises, HashSet<Guid> active, CancellationToken ct, string? focus = null,
        int? weekday = null, int? sourcePage = null)
    {
        var exercises = new List<DraftExercise>();
        if (!restDay)
        {
            foreach (var source in sourceExercises ?? [])
            {
                Guid? id = Guid.TryParse(source.ExerciseId, out var parsed) && active.Contains(parsed) ? parsed : null;
                id ??= await catalog.Match(source.SourceName, ct);
                var working = source.Sets.Select(ToDraftSet).ToList();
                var warmups = ParseWarmupCount(source.WarmupSets);
                // A movement can be listed with no prescription at all, and then there is nothing
                // for a warm-up to be modelled on. The exercise is given its one set further on.
                if (warmups > 0 && working.Count > 0)
                {
                    var seed = working[0];
                    var warmup = seed with { Warmup = true, RepsSource = "inferred", RpeSource = seed.TargetRpe == null ? "inferred" : seed.RpeSource };
                    working.InsertRange(0, Enumerable.Repeat(warmup, warmups));
                }
                var noteParts = new[] { ImportNormalization.Text(source.Notes, 1000), ImportNormalization.Text(source.CoachingNotes, 1000) }
                    .Where(value => value is not null).Select(value => value!).ToList();
                var alternates = ImportNormalization.Alternates(source.Substitutions);
                // An exercise holds two substitutions. A program that lists four has still said
                // something about the other two, so they are written into the note rather than
                // dropped on the floor.
                var substitutions = alternates.Take(2).ToList();
                if (alternates.Count > 2) noteParts.Add($"Other alternates: {string.Join(", ", alternates.Skip(2))}");
                exercises.Add(new DraftExercise(Guid.NewGuid(), ImportNormalization.Label(source.SourceName, 160, "Unnamed exercise"), id, Note(noteParts), working,
                    ImportNormalization.Text(source.SequenceGroup, 8) ?? "", substitutions, ImportNormalization.Page(source.SourcePage)));
            }
        }
        // Weeks, weekdays and page numbers are brought into the range a stored day has rather than
        // failing the section that reported them: a miscounted page or a weekday outside Monday to
        // Sunday is a slip in one field, not a reason to throw away a whole transcription.
        var storedWeek = ImportNormalization.Week(week);
        return new DraftWorkout(Guid.NewGuid(), storedWeek, ImportNormalization.Label(name, 120, $"Week {storedWeek} day"),
            ImportNormalization.Text(focus, 120), ImportNormalization.Text(notes, 2000), exercises,
            ImportNormalization.Text(block, 80), ImportNormalization.Text(phase, 120), ImportNormalization.Week(phaseWeek), restDay,
            ImportNormalization.Weekday(weekday), ImportNormalization.Page(sourcePage));
    }

    /// Joins what an exercise's note is made of, within the length a note can hold. Trimming the
    /// tail is better than failing the import over an unusually chatty source row.
    private static string? Note(List<string> parts)
    {
        if (parts.Count == 0) return null;
        var note = string.Join(" — ", parts);
        return note.Length <= 1000 ? note : note[..1000].TrimEnd();
    }

    private static DraftSet ToDraftSet(AiSet set)
    {
        // A stored set needs rep bounds, an RPE on the 1-10 half-point scale, and a rest inside
        // an hour. A row written as a timed hold, an AMRAP finisher, or a high-to-low range gives
        // none of those cleanly, so each value is brought into range and marked inferred when it
        // had to move. What the page actually said stays verbatim in the text fields below.
        var reps = ImportNormalization.Reps(set.RepMin, set.RepMax);
        var rpeValue = ImportNormalization.Rpe(set.TargetRpe);
        var restValue = ImportNormalization.Rest(DeriveRest(set.RestText, set.RestSeconds));
        var repsSource = ImportNormalization.Provenance(set.RepsSource);
        if (reps.Adjusted) repsSource = "inferred";
        if (!string.IsNullOrWhiteSpace(set.RepsText) && !Regex.IsMatch(set.RepsText.Trim(), @"^\d+\s*(?:[-–]\s*\d+)?$")) repsSource = "inferred";
        var rpe = rpeValue.Value;
        var rpeSource = rpeValue.Adjusted ? "inferred" : ImportNormalization.Provenance(set.RpeSource);
        if (rpe == null && TryFirstNumber(set.Rir, out var rir))
        {
            // RIR is useful evidence, but an out-of-range conversion is not a reason to invent a
            // target that the document never supplied. Leave it visibly unresolved for review.
            var inferred = 10 - rir;
            if (inferred is >= 6 and <= 10) { rpe = inferred; rpeSource = "inferred"; }
        }
        return new DraftSet(reps.Min, reps.Max, rpe, restValue.Value,
            ImportNormalization.Text(set.Tempo, 24), ImportNormalization.Text(set.LoadText, 60), ImportNormalization.Text(set.Notes, 400),
            repsSource, rpeSource, restValue.Adjusted ? "inferred" : ImportNormalization.Provenance(set.RestSource),
            ImportNormalization.Text(set.RepsText, 40), ImportNormalization.Text(set.RestText, 24),
            ImportNormalization.Text(set.Percent1Rm, 24), ImportNormalization.Text(set.Rir, 16), false, ImportNormalization.Page(set.SourcePage));
    }

    private static int? DeriveRest(string? text, int? fallback)
    {
        if (string.IsNullOrWhiteSpace(text)) return fallback;
        var numbers = NumberMatches(text).ToList();
        if (numbers.Count != 1 || !TryFirstNumber(text, out var number)) return fallback;
        var lower = text.ToLowerInvariant();
        // A written rest is stated in seconds, minutes, or occasionally hours. Reading "2 hours"
        // as two seconds would quietly turn a long rest into none at all.
        var multiplier = lower.Contains("hour") || lower.Contains("hr") ? 3600 : lower.Contains("min") ? 60 : 1;
        return (int)Math.Round(number * multiplier, MidpointRounding.AwayFromZero);
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
        // An unfinished import whose extracted text expired can never be completed, and there is
        // no history to preserve it in. A finished draft simply loses the text it no longer needs.
        await db.Imports.IgnoreQueryFilters()
            .Where(i => i.SourceExpiresAt != null && i.SourceExpiresAt < now && i.Status == ImportStatus.Pending)
            .ExecuteDeleteAsync(ct);
        await db.Imports.IgnoreQueryFilters()
            .Where(i => i.SourceExpiresAt != null && i.SourceExpiresAt < now)
            .ExecuteUpdateAsync(set => set.SetProperty(i => i.SourceTextJson, "").SetProperty(i => i.SourceExpiresAt, (DateTime?)null), ct);

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

    public Task ValidateDraft(ImportDraft draft, CancellationToken ct) => ImportValidation.ValidateDraft(draft, catalog, ct);

    private Task ValidateWorkout(DraftWorkout workout, CancellationToken ct) => ImportValidation.ValidateWorkout(workout, catalog, ct);

    private static SetPrescription ToPrescription(DraftSet set) => ImportValidation.ToPrescription(set);

    private static List<ImportChunk> SplitChunks(List<AiOutlineChunk> source) => ImportValidation.SplitChunks(source);

    private static List<ImportChunk> SplitChunks(List<ImportChunk> source) => ImportValidation.SplitChunks(source);

    private static List<ImportChunk> ReadChunks(string json) => ImportValidation.ReadChunks(json);

    private static (List<DraftWorkout> Workouts, bool Renumbered) NormalizePhaseWeeks(List<DraftWorkout> workouts)
        => ImportValidation.NormalizePhaseWeeks(workouts);

    private static ImportValidation.ChunkMerge ReconcileChunkCoverage(ImportDraft existing, ImportDraft extracted, ImportChunk chunk)
        => ImportValidation.ReconcileChunkCoverage(existing, extracted, chunk);

    private static (List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices) ReconcileDayShape(List<DraftWorkout> days)
        => ImportDayShape.Reconcile(days);

    private static List<ImportReviewIssue> ReadNotices(string json) => ImportValidation.ReadNotices(json);

    private void UpdateCounters(AiImport import, ImportDraft draft)
    {
        var unresolved = Unresolved(draft);
        import.UnresolvedCount = unresolved.Count;
        import.CatalogStale = draft.Workouts.SelectMany(w => w.Exercises).Any(e => e.ExerciseId is null ? false : !db.Exercises.Any(x => x.Id == e.ExerciseId && x.Active));
    }

    private static void ValidateChunkPages(IEnumerable<ImportChunk> chunks, string coverageJson)
        => ImportValidation.ValidateChunkPages(chunks, coverageJson);

    private static void ValidateDraftPages(ImportDraft draft, string coverageJson)
        => ImportValidation.ValidateDraftPages(draft, coverageJson);

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
