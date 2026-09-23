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

    public async Task<ImportStatusView> GetStatus(Guid id, CancellationToken ct)
    {
        var import = await db.Imports.AsNoTracking().SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        var chunks = ReadChunks(import!.OutlineJson);
        var completedCount = ReadChunkResults(import.ChunkResultsJson).Count;
        var done = import.Status == ImportStatus.Ready ? import.ChunksDone : Math.Max(import.ChunksDone, completedCount);
        return new ImportStatusView(import.Id, import.Status, import.Stage, done, import.ChunksTotal,
            chunks.ElementAtOrDefault(done)?.Label ?? chunks.ElementAtOrDefault(import.ChunksDone)?.Label, import.Error, import.Revision, import.Retries,
            import.UnresolvedCount);
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
        var coverage = string.IsNullOrWhiteSpace(import.PageCoverageJson) ? [] : Json.Read<List<PdfPageCoverage>>(import.PageCoverageJson);
        var alternatives = string.IsNullOrWhiteSpace(import.AlternativesJson) ? [] : Json.Read<List<ImportAlternative>>(import.AlternativesJson);
        var acceptable = import.Status == ImportStatus.Ready && unresolved.Count == 0 && issues.All(i => i.Severity == "info");
        var (canRestoreDraft, restorableExerciseLineIds) = AnalyzeRestorability(import, draft);
        var completedCount = ReadChunkResults(import.ChunkResultsJson).Count;
        var done = import.Status == ImportStatus.Ready ? import.ChunksDone : Math.Max(import.ChunksDone, completedCount);
        return new ImportView(import.Id, import.Status, import.FileName, import.Pages, import.Error, import.Created, import.Model,
            import.Stage, done, import.ChunksTotal, chunks.ElementAtOrDefault(done)?.Label ?? chunks.ElementAtOrDefault(import.ChunksDone)?.Label, unresolvedCount, draft,
            unresolved, acceptable, import.ProgramId, issues,
            import.InputTokens, import.OutputTokens, import.Retries, coverage, alternatives, import.SelectedAlternativeId,
            import.Revision, canRestoreDraft, restorableExerciseLineIds);
    }

    public static List<UnresolvedExercise> Unresolved(ImportDraft draft) => ImportValidation.Unresolved(draft);

    private static List<ImportReviewIssue> ReviewIssues(ImportDraft draft) => ImportValidation.ReviewIssues(draft);

    /// Every id the model proposes is checked against the live catalog here. An id that does not
    /// resolve is dropped to null so the reviewer can keep the written exercise name.
    public async Task<ImportDraft> ToDraft(AiProgram program, CancellationToken ct)
    {
        var active = await catalog.ActiveIds(ct);
        // A draft is a hundred written names, and reading the whole library for each of them was a
        // hundred passes over the catalog. It is read once here and asked directly per name.
        var library = await catalog.MatchIndex(ct);
        var all = await catalog.All(ct);
        var canonicalNames = all.ToDictionary(x => x.Id, x => x.Name);
        var title = ImportNormalization.Label(program.ProgramTitle ?? program.ProgramName, 120, "Imported program");
        var workouts = new List<DraftWorkout>();
        if (program.Days is { } days)
        {
            foreach (var day in days)
                workouts.Add(ToDraftWorkout(day.Block, day.Phase, day.WeekNumber, day.PhaseWeek, day.DayName, day.IsRestDay, day.Notes, day.Exercises, active, library, canonicalNames, sourcePage: day.SourcePage));
        }
        else
        {
            foreach (var week in program.Weeks!.OrderBy(w => w.Week))
                foreach (var workout in week.Workouts ?? [])
                    workouts.Add(ToDraftWorkout(null, null, week.Week, 1, workout.Name, false, workout.Notes, workout.Exercises, active, library, canonicalNames, workout.Focus));
        }
        return new ImportDraft(title, workouts);
    }

    private static DraftWorkout ToDraftWorkout(string? block, string? phase, int week, int phaseWeek, string? name, bool restDay,
        string? notes, List<AiExercise>? sourceExercises, HashSet<Guid> active, Dictionary<string, Guid> library,
        Dictionary<Guid, string> canonicalNames, string? focus = null, int? sourcePage = null)
    {
        var exercises = new List<DraftExercise>();
        if (!restDay)
        {
            foreach (var source in sourceExercises ?? [])
            {
                var rawName = source.SourceName?.Trim() ?? "";
                var sequenceGroup = ImportNormalization.Text(source.SequenceGroup, 8) ?? "";

                // A table cell often embeds a superset tag like "A1: Seated Calf Raise". Strip the
                // tag from the movement name and adopt it as sequenceGroup if none was stated.
                var cleanName = rawName;
                var prefix = Regex.Match(rawName, @"^(?<group>[A-Za-z]\d+)(?::|\.|\s*[-–]\s+|\s+)\s*(?<name>.+)$");
                if (prefix.Success)
                {
                    if (string.IsNullOrEmpty(sequenceGroup))
                        sequenceGroup = ImportNormalization.Text(prefix.Groups["group"].Value, 8) ?? "";
                    cleanName = prefix.Groups["name"].Value.Trim();
                }

                // Exercise cells can carry embedded video hyperlinks from PDF design layers.
                // Pull URLs into the notes so the written movement name matches the catalog cleanly.
                var urlMatches = Regex.Matches(cleanName, @"https?://\S+|www\.\S+");
                var extractedUrls = new List<string>();
                if (urlMatches.Count > 0)
                {
                    foreach (Match m in urlMatches) extractedUrls.Add(m.Value);
                    cleanName = Regex.Replace(cleanName, @"https?://\S+|www\.\S+", "").Trim();
                    cleanName = Regex.Replace(cleanName, @"\(\s*\)|\[\s*\]", "").Trim();
                }

                Guid? id = Guid.TryParse(source.ExerciseId, out var parsed) && active.Contains(parsed) ? parsed : null;
                id ??= CatalogMatching.Find(library, cleanName);
                if (id == null && cleanName != rawName) id ??= CatalogMatching.Find(library, rawName);
                var working = source.Sets.Select(ToDraftSet).ToList();
                // A training table states its working sets as a count in its own column — "WORKING
                // SETS: 2" — rather than as one row per set, and a read that returns a single row
                // for it loses every set but one. The stated count is authoritative over the rows:
                // the last row is repeated up to it, marked as this app's own expansion.
                var stated = ParseSetCount(source.WorkingSets);
                while (working.Count > 0 && working.Count < stated)
                    working.Add(working[^1] with { RepsSource = "inferred", RpeSource = "inferred", RestSource = "inferred" });
                var warmups = ParseWarmupCount(source.WarmupSets);
                // A movement can be listed with no prescription at all, and then there is nothing
                // for a warm-up to be modelled on. The exercise is given its one set further on.
                if (warmups > 0 && working.Count > 0)
                {
                    var seed = working[0];
                    // The table's RPE columns prescribe working sets. Warm-up Sets is only a
                    // count, so inheriting the working row's effort invents a warm-up target.
                    var warmup = seed with
                    {
                        Warmup = true, TargetRpe = null, Rir = null,
                        RepsSource = "inferred", RpeSource = "inferred"
                    };
                    working.InsertRange(0, Enumerable.Repeat(warmup, warmups));
                }
                var noteParts = new[] { ImportNormalization.Text(source.Notes, 1000), ImportNormalization.Text(source.CoachingNotes, 1000) }
                    .Concat(extractedUrls)
                    .Where(value => value is not null).Select(value => value!).ToList();
                var alternates = (source.Substitutions ?? [])
                    .Where(s => !CatalogService.IsPlaceholder(s))
                    .Select(s =>
                    {
                        var clean = ImportNormalization.Text(s, 160);
                        if (clean == null) return null;
                        var matchId = CatalogMatching.Find(library, clean);
                        if (matchId is { } mId && canonicalNames.TryGetValue(mId, out var canonicalName))
                            return canonicalName;
                        return clean;
                    })
                    .Where(s => s is not null)
                    .Select(s => s!)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                var substitutions = alternates.Take(2).ToList();
                if (alternates.Count > 2) noteParts.Add($"Other alternates: {string.Join(", ", alternates.Skip(2))}");
                exercises.Add(new DraftExercise(Guid.NewGuid(), ImportNormalization.Label(cleanName.Length > 0 ? cleanName : rawName, 160, "Unnamed exercise"), id, Note(noteParts), working,
                    sequenceGroup, substitutions, ImportNormalization.Page(source.SourcePage), RestSeconds: DeriveRestSeconds(working)));
            }
        }
        // Weeks, weekdays and page numbers are brought into the range a stored day has rather than
        // failing the section that reported them: a miscounted page or a weekday outside Monday to
        // Sunday is a slip in one field, not a reason to throw away a whole transcription.
        var storedWeek = ImportNormalization.Week(week);
        return new DraftWorkout(Guid.NewGuid(), storedWeek, ImportNormalization.Text(name, 120) ?? "",
            ImportNormalization.Text(focus, 120), ImportNormalization.Text(notes, 2000), exercises,
            ImportNormalization.Text(block, 80), ImportNormalization.Text(phase, 120), ImportNormalization.Week(phaseWeek), restDay,
            ImportNormalization.Page(sourcePage));
    }

    /// Joins what an exercise's note is made of, within the length a note can hold. Trimming the
    /// tail is better than failing the import over an unusually chatty source row.
    private static string? Note(List<string> parts)
    {
        if (parts.Count == 0) return null;
        var note = string.Join(" — ", parts);
        return note.Length <= 1000 ? note : note[..1000].TrimEnd();
    }

    private static int? DeriveRestSeconds(List<DraftSet> sets)
    {
        var candidates = sets.Where(s => !s.Warmup && s.RestSeconds is >= 0 and <= 3600)
            .Select(s => s.RestSeconds!.Value)
            .ToList();
        if (candidates.Count == 0)
        {
            candidates = sets.Where(s => s.RestSeconds is >= 0 and <= 3600)
                .Select(s => s.RestSeconds!.Value)
                .ToList();
        }
        if (candidates.Count == 0) return null;
        return candidates
            .GroupBy(v => v)
            .OrderByDescending(g => g.Count())
            .First()
            .Key;
    }

    private static DraftSet ToDraftSet(AiSet set)
    {
        // A stored set needs rep bounds, an RPE on the 6-10 half-point scale, and a rest inside
        // an hour. A row written as a timed hold, an AMRAP finisher, or a high-to-low range gives
        // none of those cleanly, so each value is brought into range and marked inferred when it
        // had to move. What the page actually said stays verbatim in the text fields below.
        var reps = ImportNormalization.Reps(set.RepMin, set.RepMax, set.RepsText);
        var rpeValue = ImportNormalization.Rpe(set.TargetRpe);
        var restValue = ImportNormalization.Rest(DeriveRest(set.RestText, set.RestSeconds));
        var repsSource = ImportNormalization.Provenance(set.RepsSource);
        if (reps.Adjusted) repsSource = "inferred";
        if (!string.IsNullOrWhiteSpace(set.RepsText) && !Regex.IsMatch(set.RepsText.Trim(), @"^\d+\s*(?:(?:[-–]|to)\s*\d+)?\s*(?:reps?)?$", RegexOptions.IgnoreCase)) repsSource = "inferred";
        var rpe = rpeValue.Value;
        var rpeSource = rpeValue.Adjusted ? "inferred" : ImportNormalization.Provenance(set.RpeSource);
        if (rpe == null && TryFirstNumber(set.Rir, out var rir))
        {
            // RIR is useful evidence, but an out-of-range conversion is not a reason to invent a
            // target that the document never supplied. Leave it visibly unresolved for review.
            var intRir = (int)Math.Round((double)rir);
            var inferred = 10 - intRir;
            if (inferred is >= 6 and <= 10) { rpe = inferred; rpeSource = "inferred"; }
        }
        var rirText = ImportNormalization.Text(set.Rir, 16);
        if (string.IsNullOrWhiteSpace(rirText) && rpe != null)
        {
            var calculatedRir = (int)Math.Round(10 - rpe.Value);
            if (calculatedRir is >= 0 and <= 4) rirText = calculatedRir.ToString(CultureInfo.InvariantCulture);
        }
        else if (TryFirstNumber(rirText, out var parsedRir))
        {
            rirText = ((int)Math.Round((double)parsedRir)).ToString(CultureInfo.InvariantCulture);
        }
        return new DraftSet(reps.Min, reps.Max, rpe, restValue.Value,
            ImportNormalization.Text(set.Tempo, 24), ImportNormalization.Text(set.LoadText, 60), ImportNormalization.Text(set.Notes, 400),
            repsSource, rpeSource, restValue.Adjusted ? "inferred" : ImportNormalization.Provenance(set.RestSource),
            ImportNormalization.Text(set.RepsText, 40), ImportNormalization.Text(set.RestText, 24),
            rirText, false, ImportNormalization.Page(set.SourcePage));
    }

    private static int? DeriveRest(string? text, int? fallback)
    {
        if (string.IsNullOrWhiteSpace(text)) return fallback;
        var range = Regex.Match(text, @"(?<min>\d+(?:\.\d+)?)\s*(?:[-–]|to)\s*(?<max>\d+(?:\.\d+)?)", RegexOptions.IgnoreCase);
        var lower = text.ToLowerInvariant();
        if (range.Success && double.TryParse(range.Groups["min"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var minimum) &&
            double.TryParse(range.Groups["max"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var maximum))
        {
            var average = (minimum + maximum) / 2;
            var isSec = Regex.IsMatch(lower, @"\b(?:sec|secs|second|seconds)\b|(?:\d|\))\s*s\b");
            var isHr = lower.Contains("hour") || lower.Contains("hr");
            var multiplier = isSec ? 1 : isHr ? 3600 : (Regex.IsMatch(lower, @"\b(?:m|min|mins|minute|minutes)\b|(?:\d|\))\s*m\b") || average <= 10) ? 60 : 1;
            return (int)Math.Round(average * multiplier, MidpointRounding.AwayFromZero);
        }
        if (!TryFirstNumber(text, out var number)) return fallback;
        // When the text carries no unit letters the AI's restSeconds is a better authority than
        // defaulting to seconds, because the model reads document-level context like "REST TIMES
        // ARE GIVEN IN MINUTES" that this parser cannot see.
        if (!Regex.IsMatch(text, @"[a-zA-Z]"))
        {
            if (fallback is not null) return fallback;
            // When no fallback exists, small decimal or integer numbers (<= 10) in training tables
            // represent minutes (e.g. 1.0, 1.5, 2.0, 3.0); resistance rest is never 2 seconds.
            if (number > 0 && number <= 10)
                return (int)Math.Round(number * 60, MidpointRounding.AwayFromZero);
            return (int)Math.Round(number, MidpointRounding.AwayFromZero);
        }
        var isSingleSec = Regex.IsMatch(lower, @"\b(?:sec|secs|second|seconds)\b|(?:\d|\))\s*s\b");
        var isSingleHr = lower.Contains("hour") || lower.Contains("hr");
        var singleMultiplier = isSingleSec ? 1 : isSingleHr ? 3600 : (Regex.IsMatch(lower, @"\b(?:m|min|mins|minute|minutes)\b|(?:\d|\))\s*m\b") || number <= 10) ? 60 : 1;
        return (int)Math.Round(number * singleMultiplier, MidpointRounding.AwayFromZero);
    }

    private static int ParseWarmupCount(string? text)
    {
        if (!TryFirstNumber(text, out var number)) return 0;
        return Math.Clamp((int)Math.Floor(number), 0, 8);
    }

    /// A stated working-set count, held to what one exercise can carry.
    private static int ParseSetCount(string? text)
    {
        if (!TryFirstNumber(text, out var number)) return 0;
        return Math.Clamp((int)Math.Floor(number), 0, ImportDayShape.MaxExerciseSets);
    }

    private static bool TryFirstNumber(string? text, out double value)
    {
        var match = Regex.Match(text ?? "", @"\d+(?:\.\d+)?");
        if (!match.Success || !double.TryParse(match.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out value)) { value = 0; return false; }
        return true;
    }

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
