using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record ImportChunk(string Label, string? Block, string? Phase, int WeekFrom, int WeekTo, int PageFrom, int PageTo, int DayCount);
public record DraftSet(
    int RepMin, int RepMax, double? TargetRpe, int? RestSeconds, string? Tempo, string? LoadText, string? Notes,
    string RepsSource = "extracted", string RpeSource = "extracted", string RestSource = "extracted",
    string? RepsText = null, string? RestText = null, string? Percent1Rm = null, string? Rir = null, bool Warmup = false);
public record DraftExercise(Guid LineId, string SourceName, Guid? ExerciseId, string? Notes, List<DraftSet> Sets,
    string SequenceGroup = "", List<string>? Substitutions = null);
public record DraftWorkout(Guid LineId, int Week, string Name, string? Focus, string? Notes, List<DraftExercise> Exercises,
    string? Block = null, string? Phase = null, int PhaseWeek = 1, bool IsRestDay = false);
public record ImportDraft(string ProgramName, string? Description, List<DraftWorkout> Workouts);
public record ImportMetadata(string ProgramName, string? Description);
public record UnresolvedExercise(Guid LineId, string SourceName);
public record ImportView(Guid Id, string Status, string FileName, int Pages, string Error, DateTime Created, string Model,
    string Stage, int ChunksDone, int ChunksTotal, string? CurrentChunkLabel, int UnresolvedCount, ImportDraft? Draft,
    List<UnresolvedExercise> Unresolved, bool Acceptable, Guid? ProgramId);

public sealed class ImportService(AppDb db, WorkoutAi ai, CatalogService catalog, ProgramService programs)
{
    public const int DailyLimit = 150;

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
        return new ImportView(import.Id, import.Status, import.FileName, import.Pages, import.Error, import.Created, import.Model,
            import.Stage, import.ChunksDone, import.ChunksTotal, chunks.ElementAtOrDefault(import.ChunksDone)?.Label, unresolvedCount, draft,
            // Unmapped names are a review warning, not a reason to discard a faithful import;
            // a catalog id that went inactive is different and still needs rematching.
            unresolved, import.Status == ImportStatus.Ready && !import.CatalogStale, import.ProgramId);
    }

    public static List<UnresolvedExercise> Unresolved(ImportDraft draft)
        => draft.Workouts.Where(w => !w.IsRestDay).SelectMany(w => w.Exercises).Where(e => e.ExerciseId == null)
            .Select(e => new UnresolvedExercise(e.LineId, e.SourceName)).ToList();

    public async Task<ImportView> Create(byte[] pdf, string fileName, CancellationToken ct)
    {
        ValidatePdf(pdf, fileName);
        var hash = Convert.ToHexString(SHA256.HashData(pdf));
        var user = db.CurrentUser!.Value;
        var existing = await db.Imports.AsNoTracking().FirstOrDefaultAsync(i => i.DocumentHash == hash && i.PromptVersion == WorkoutAi.PromptVersion
            && (i.Status == ImportStatus.Pending || i.Status == ImportStatus.Ready || i.Status == ImportStatus.Accepted), ct);
        if (existing != null) return await Get(existing.Id, ct);

        var import = new AiImport
        {
            UserId = user, DocumentHash = hash, PromptVersion = WorkoutAi.PromptVersion,
            FileName = fileName.Trim(), Pages = PdfInspection.ApproximatePages(pdf), Status = ImportStatus.Pending, Stage = "outline"
        };
        db.Imports.Add(import);
        await db.SaveChangesAsync(ct);

        try
        {
            await Meter(import, ct);
            var library = await catalog.All(ct);
            var result = await ai.Outline(pdf, import.FileName, library, AuthService.Hash(user.ToString())[..32], ct);
            import.Model = result.Model; import.InputTokens += result.InputTokens; import.OutputTokens += result.OutputTokens; import.Error = "";
            if (result.LegacyProgram is { } legacy)
            {
                var draft = await ToDraft(legacy, ct);
                await ValidateDraft(draft, ct);
                import.DraftJson = Json.Write(draft); import.Stage = "done"; import.Status = ImportStatus.Ready;
                import.ChunksDone = 1; import.ChunksTotal = 1;
                UpdateCounters(import, draft);
            }
            else
            {
                var chunks = SplitChunks(result.Outline!.Chunks);
                import.OutlineJson = Json.Write(chunks);
                import.DraftJson = Json.Write(new ImportDraft(result.Outline.ProgramTitle, result.Outline.Description, []));
                import.Stage = "extract"; import.Status = ImportStatus.Pending; import.ChunksDone = 0; import.ChunksTotal = chunks.Count;
                import.UnresolvedCount = 0; import.CatalogStale = false;
            }
        }
        catch (DomainException ex)
        {
            import.Status = ImportStatus.Failed; import.Error = ex.Message;
            await db.SaveChangesAsync(ct);
            throw;
        }
        await db.SaveChangesAsync(ct);
        return await Get(import.Id, ct);
    }

    public async Task<ImportView> Extract(Guid id, byte[] pdf, string fileName, CancellationToken ct)
    {
        ValidatePdf(pdf, fileName);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Pending && import.Stage == "extract", "This import is not waiting for another extraction pass.", 409);
        var hash = Convert.ToHexString(SHA256.HashData(pdf));
        Validation.Require(hash == import.DocumentHash, "Choose the same PDF that started this import so the next chunk can be verified.", 409);
        var chunks = ReadChunks(import.OutlineJson);
        Validation.Require(import.ChunksDone < chunks.Count, "This import has already finished extracting.", 409);
        var chunk = chunks[import.ChunksDone];
        try
        {
            await Meter(import, ct);
            var result = await ai.ExtractChunk(pdf, import.FileName, await catalog.All(ct), AuthService.Hash(db.CurrentUser!.Value.ToString())[..32],
                $"Extract only chunk '{chunk.Label}', covering block '{chunk.Block}', phase '{chunk.Phase}', absolute weeks {chunk.WeekFrom}-{chunk.WeekTo}, pages {chunk.PageFrom}-{chunk.PageTo}. Return those days and no days from other chunks.", ct);
            var existing = Json.Read<ImportDraft>(import.DraftJson);
            var extracted = await ToDraft(result.Program, ct);
            var title = result.Program.ProgramTitle ?? result.Program.ProgramName ?? existing.ProgramName;
            var description = result.Program.Description ?? existing.Description;
            var merged = existing with { ProgramName = title, Description = description, Workouts = [.. existing.Workouts, .. extracted.Workouts] };
            import.DraftJson = Json.Write(merged); import.ChunksDone++; import.Model = result.Model;
            import.InputTokens += result.InputTokens; import.OutputTokens += result.OutputTokens; import.Error = "";
            if (import.ChunksDone >= import.ChunksTotal)
            {
                await ValidateDraft(merged, ct);
                import.Status = ImportStatus.Ready; import.Stage = "done"; UpdateCounters(import, merged);
            }
            await db.SaveChangesAsync(ct);
        }
        catch (DomainException ex)
        {
            import.Error = ex.Message;
            await db.SaveChangesAsync(ct);
            throw;
        }
        return await Get(id, ct);
    }

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
                workouts.Add(await ToDraftWorkout(day.Block, day.Phase, day.WeekNumber, day.PhaseWeek, day.DayName, day.IsRestDay, day.Notes, day.Exercises, active, ct));
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
        string? notes, List<AiExercise> sourceExercises, HashSet<Guid> active, CancellationToken ct, string? focus = null)
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
                    source.SequenceGroup?.Trim() ?? "", substitutions));
            }
        }
        return new DraftWorkout(Guid.NewGuid(), week, name.Trim(), focus, notes, exercises, block, phase, phaseWeek, restDay);
    }

    private static DraftSet ToDraftSet(AiSet set)
    {
        var reps = DeriveReps(set.RepsText, set.RepMin, set.RepMax);
        var rest = DeriveRest(set.RestText, set.RestSeconds);
        var repsSource = set.RepsSource;
        if (!string.IsNullOrWhiteSpace(set.RepsText) && !Regex.IsMatch(set.RepsText.Trim(), @"^\d+\s*(?:[-–]\s*\d+)?$")) repsSource = "inferred";
        var rpe = set.TargetRpe;
        var rpeSource = set.RpeSource;
        if (rpe == null && TryFirstNumber(set.Rir, out var rir)) { rpe = Math.Clamp(10 - rir, 1, 10); rpeSource = "inferred"; }
        return new DraftSet(reps.Min, reps.Max, rpe, rest, set.Tempo, set.LoadText, set.Notes,
            repsSource, rpeSource, set.RestSource, NullIfBlank(set.RepsText), NullIfBlank(set.RestText), NullIfBlank(set.Percent1Rm), NullIfBlank(set.Rir));
    }

    private static (int Min, int Max) DeriveReps(string? text, int min, int max)
    {
        if (string.IsNullOrWhiteSpace(text)) return (min, max);
        var value = text.Trim();
        if (value.Contains('+'))
        {
            var first = NumberMatches(value).FirstOrDefault();
            return first > 0 ? (first, first) : (min, max);
        }
        if (value.Contains('/'))
        {
            var numbers = NumberMatches(value).ToList();
            if (numbers.Count > 0) return (numbers.Sum(), numbers.Sum());
        }
        return (min, max);
    }

    private static int? DeriveRest(string? text, int? fallback)
    {
        if (string.IsNullOrWhiteSpace(text)) return fallback;
        if (!TryFirstNumber(text, out var number)) return fallback;
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
    public async Task<ProgramView> Accept(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import has already been accepted or discarded.", 409);
        var draft = Json.Read<ImportDraft>(import.DraftJson);
        await ValidateDraft(draft, ct);
        var input = new ProgramInput(draft.ProgramName, draft.Description,
            draft.Workouts.Select(w => new ProgramWorkoutInput(w.Week, w.Name, w.Focus, w.Notes,
                w.Exercises.Select(e => new TemplateExerciseInput(e.ExerciseId, e.SourceName, e.Notes,
                    e.Sets.Select(ToPrescription).ToList(), e.SequenceGroup, e.Substitutions)).ToList(),
                w.Block, w.Phase, w.PhaseWeek, w.IsRestDay)).ToList(), null);
        await programs.Validate(input, ct);
        var program = await programs.Materialize(input, activate: true, sourceImportId: import.Id, ct);
        import.Status = ImportStatus.Accepted; import.ProgramId = program.Id; import.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await programs.Get(program.Id, ct);
    }

    public async Task Discard(Guid id, CancellationToken ct)
    {
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status != ImportStatus.Accepted, "An accepted program is removed from Programs, not here.", 409);
        import.Status = ImportStatus.Discarded; import.DraftJson = ""; import.OutlineJson = ""; import.Revision++;
        await db.SaveChangesAsync(ct);
    }

    public async Task ValidateDraft(ImportDraft draft, CancellationToken ct)
    {
        Validation.Name(draft.ProgramName, "Program name");
        Validation.Text(draft.Description, 4000, "Program description");
        Validation.Require(draft.Workouts is { Count: > 0 and <= 400 }, "A program needs between 1 and 400 days.");
        Validation.Require(draft.Workouts.All(w => w.Week is > 0 and <= 104), "Program weeks must be between 1 and 104.");
        foreach (var workout in draft.Workouts) await ValidateWorkout(workout, ct);
    }

    private async Task ValidateWorkout(DraftWorkout workout, CancellationToken ct)
    {
        Validation.Name(workout.Name, "Workout name");
        Validation.Text(workout.Block, 80, "Block"); Validation.Text(workout.Phase, 120, "Phase");
        Validation.Text(workout.Focus, 120, "Focus"); Validation.Text(workout.Notes, 2000, "Workout notes");
        Validation.Require(workout.PhaseWeek is > 0 and <= 104, "Phase week must be between 1 and 104.");
        Validation.Require(workout.IsRestDay ? workout.Exercises is { Count: 0 } : workout.Exercises is { Count: > 0 and <= 40 },
            workout.IsRestDay ? "A rest day cannot contain exercises." : "Each workout needs between 1 and 40 exercises.");
        foreach (var exercise in workout.Exercises)
        {
            Validation.Name(exercise.SourceName, "Exercise name", 160); Validation.Text(exercise.Notes, 1000, "Exercise notes");
            Validation.Text(exercise.SequenceGroup, 8, "Sequence group"); Validation.Substitutions(exercise.Substitutions);
            Validation.Prescriptions(exercise.Sets.Select(ToPrescription).ToList());
            foreach (var set in exercise.Sets)
                foreach (var source in new[] { set.RepsSource, set.RpeSource, set.RestSource })
                    Validation.Require(source is "extracted" or "inferred" or "userEdited", "Unknown provenance label.");
            await catalog.RequireActive(exercise.ExerciseId, ct);
        }
    }

    private static SetPrescription ToPrescription(DraftSet set)
        => new(set.RepMin, set.RepMax, set.TargetRpe, set.RestSeconds, set.Tempo, set.LoadText, set.Notes,
            set.RepsText, set.RestText, set.Percent1Rm, set.Rir, set.Warmup, set.RepsSource, set.RpeSource, set.RestSource);

    private static List<ImportChunk> SplitChunks(List<AiOutlineChunk> source)
    {
        var result = new List<ImportChunk>();
        foreach (var chunk in source)
        {
            var remaining = chunk.DayCount;
            var offset = 0;
            while (remaining > 0)
            {
                var count = Math.Min(12, remaining);
                var week = chunk.WeekFrom + Math.Min(Math.Max(0, offset / 7), chunk.WeekTo - chunk.WeekFrom);
                var label = remaining == chunk.DayCount ? chunk.Label : $"{chunk.Label} · part {result.Count + 1}";
                result.Add(new ImportChunk(label, chunk.Block, chunk.Phase, week, Math.Min(chunk.WeekTo, week + Math.Max(0, (count - 1) / 7)),
                    chunk.PageFrom, chunk.PageTo, count));
                offset += count; remaining -= count;
            }
        }
        Validation.Require(result.Count is > 0 and <= 24, "This program has too many extraction chunks.", 422);
        return result;
    }

    private static List<ImportChunk> ReadChunks(string json)
        => string.IsNullOrWhiteSpace(json) ? [] : Json.Read<List<ImportChunk>>(json);

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
        Validation.Require(pdf.Length <= PdfInspection.MaxBytes, "That PDF is larger than 20 MB.", 413);
        Validation.Require(PdfInspection.LooksLikePdf(pdf), "That file is not a PDF.");
        var pages = PdfInspection.ApproximatePages(pdf);
        Validation.Require(pages <= PdfInspection.MaxPages, $"That PDF has about {pages} pages; the importer accepts up to {PdfInspection.MaxPages}.");
        Validation.Name(fileName, "File name", 200);
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
