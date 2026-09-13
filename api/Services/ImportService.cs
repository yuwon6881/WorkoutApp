using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record DraftSet(int RepMin, int RepMax, double? TargetRpe, int? RestSeconds, string? Tempo, string? LoadText, string? Notes, string RepsSource, string RpeSource, string RestSource);
public record DraftExercise(Guid LineId, string SourceName, Guid? ExerciseId, string? Notes, List<DraftSet> Sets);
public record DraftWorkout(Guid LineId, int Week, string Name, string? Focus, string? Notes, List<DraftExercise> Exercises);
public record ImportDraft(string ProgramName, string? Description, List<DraftWorkout> Workouts);
public record UnresolvedExercise(Guid LineId, string SourceName);
public record ImportView(Guid Id, string Status, string FileName, int Pages, string Error, DateTime Created, string Model, ImportDraft? Draft, List<UnresolvedExercise> Unresolved, bool Acceptable, Guid? ProgramId);

public sealed class ImportService(AppDb db, WorkoutAi ai, CatalogService catalog, ProgramService programs)
{
    public const int DailyLimit = 20;

    public async Task<List<ImportView>> List(CancellationToken ct)
    {
        var rows = await db.Imports.AsNoTracking().Where(i => i.Status != ImportStatus.Discarded).OrderByDescending(i => i.Created).Take(50).ToListAsync(ct);
        var views = new List<ImportView>();
        foreach (var row in rows) views.Add(await View(row, ct));
        return views;
    }

    public async Task<ImportView> Get(Guid id, CancellationToken ct)
    {
        var import = await db.Imports.AsNoTracking().SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        return await View(import!, ct);
    }

    public async Task<ImportView> View(AiImport import, CancellationToken ct)
    {
        var draft = string.IsNullOrEmpty(import.DraftJson) ? null : Json.Read<ImportDraft>(import.DraftJson);
        var unresolved = draft == null ? [] : Unresolved(draft);
        var active = await catalog.ActiveIds(ct);
        // A mapping can go stale if the catalog changes under a saved draft, so acceptability is
        // recomputed from the live catalog rather than trusted from the stored draft.
        var stale = draft != null && draft.Workouts.SelectMany(w => w.Exercises).Any(e => e.ExerciseId is { } id && !active.Contains(id));
        return new ImportView(import.Id, import.Status, import.FileName, import.Pages, import.Error, import.Created, import.Model, draft,
            unresolved, import.Status == ImportStatus.Ready && unresolved.Count == 0 && !stale, import.ProgramId);
    }

    public static List<UnresolvedExercise> Unresolved(ImportDraft draft)
        => draft.Workouts.SelectMany(w => w.Exercises).Where(e => e.ExerciseId == null)
            .Select(e => new UnresolvedExercise(e.LineId, e.SourceName)).ToList();

    public async Task<ImportView> Create(byte[] pdf, string fileName, CancellationToken ct)
    {
        Validation.Require(pdf.Length > 0, "Choose a PDF to import.");
        Validation.Require(pdf.Length <= PdfInspection.MaxBytes, "That PDF is larger than 20 MB.", 413);
        Validation.Require(PdfInspection.LooksLikePdf(pdf), "That file is not a PDF.");
        var pages = PdfInspection.ApproximatePages(pdf);
        Validation.Require(pages <= PdfInspection.MaxPages, $"That PDF has about {pages} pages; the importer accepts up to {PdfInspection.MaxPages}.");
        Validation.Name(fileName, "File name", 200);

        var hash = Convert.ToHexString(SHA256.HashData(pdf));
        var user = db.CurrentUser!.Value;
        // The same document under the same prompt reuses its draft instead of spending a call.
        var existing = await db.Imports.AsNoTracking().FirstOrDefaultAsync(i => i.DocumentHash == hash && i.PromptVersion == WorkoutAi.PromptVersion && i.Status == ImportStatus.Ready, ct);
        if (existing != null) return await View(existing, ct);

        await Meter(ct);
        var import = new AiImport
        {
            UserId = user, DocumentHash = hash, PromptVersion = WorkoutAi.PromptVersion,
            FileName = fileName.Trim(), Pages = pages, Status = ImportStatus.Pending
        };
        db.Imports.Add(import);
        await db.SaveChangesAsync(ct);

        try
        {
            var library = await catalog.All(ct);
            // The safety identifier is a stable pseudonym for the account, not the username itself.
            var result = await ai.Extract(pdf, import.FileName, library, AuthService.Hash(user.ToString())[..32], ct);
            var draft = await ToDraft(result.Program, ct);
            import.DraftJson = Json.Write(draft); import.Status = ImportStatus.Ready; import.Model = result.Model;
            import.InputTokens = result.InputTokens; import.OutputTokens = result.OutputTokens;
        }
        catch (DomainException ex)
        {
            // Only metadata and the failure reason survive: the PDF bytes are never stored, so a
            // failed import has to be uploaded again rather than retried from the server.
            import.Status = ImportStatus.Failed; import.Error = ex.Message;
            await db.SaveChangesAsync(ct);
            throw;
        }
        await db.SaveChangesAsync(ct);
        return await Get(import.Id, ct);
    }

    /// Every id the model proposes is checked against the live catalog here. An id that does not
    /// resolve is dropped to null so the reviewer maps it by hand.
    public async Task<ImportDraft> ToDraft(AiProgram program, CancellationToken ct)
    {
        var active = await catalog.ActiveIds(ct);
        var workouts = new List<DraftWorkout>();
        foreach (var week in program.Weeks.OrderBy(w => w.Week))
            foreach (var workout in week.Workouts ?? [])
            {
                var exercises = new List<DraftExercise>();
                foreach (var exercise in workout.Exercises!)
                {
                    Guid? id = Guid.TryParse(exercise.ExerciseId, out var parsed) && active.Contains(parsed) ? parsed : null;
                    // A name the model left unmapped may still match the catalog exactly or by alias.
                    id ??= await catalog.Match(exercise.SourceName, ct);
                    exercises.Add(new DraftExercise(Guid.NewGuid(), exercise.SourceName.Trim(), id, exercise.Notes,
                        exercise.Sets!.Select(s => new DraftSet(s.RepMin, s.RepMax, s.TargetRpe, s.RestSeconds, s.Tempo, s.LoadText, s.Notes, s.RepsSource, s.RpeSource, s.RestSource)).ToList()));
                }
                workouts.Add(new DraftWorkout(Guid.NewGuid(), week.Week, workout.Name.Trim(), workout.Focus, workout.Notes, exercises));
            }
        return new ImportDraft(program.ProgramName.Trim(), program.Description, workouts);
    }

    public async Task<ImportView> Edit(Guid id, ImportDraft draft, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import is no longer editable.", 409);
        await ValidateDraft(draft, ct);
        import.DraftJson = Json.Write(draft); import.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    /// Re-runs catalog matching over the saved draft. This is how a draft parked before a seed
    /// picks up newly available exercises without another AI call.
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
            var exercises = new List<DraftExercise>();
            foreach (var exercise in workout.Exercises)
            {
                var resolved = exercise.ExerciseId is { } current && active.Contains(current) ? current : await catalog.Match(exercise.SourceName, ct);
                exercises.Add(exercise with { ExerciseId = resolved });
            }
            workouts.Add(workout with { Exercises = exercises });
        }
        import.DraftJson = Json.Write(draft with { Workouts = workouts }); import.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    /// Acceptance is all-or-nothing: the program and every workout template appear together,
    /// or the import stays a draft.
    public async Task<ProgramView> Accept(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
        Validation.Require(import != null, "That import no longer exists.", 404);
        Validation.Require(import!.Status == ImportStatus.Ready, "This import has already been accepted or discarded.", 409);
        var draft = Json.Read<ImportDraft>(import.DraftJson);
        await ValidateDraft(draft, ct);
        Validation.Require(Unresolved(draft).Count == 0, "Map every exercise to the library before accepting this program.", 409);

        var input = new ProgramInput(draft.ProgramName, draft.Description,
            draft.Workouts.Select(w => new ProgramWorkoutInput(w.Week, w.Name, w.Focus, w.Notes,
                w.Exercises.Select(e => new TemplateExerciseInput(e.ExerciseId, e.SourceName, e.Notes,
                    e.Sets.Select(s => new SetPrescription(s.RepMin, s.RepMax, s.TargetRpe, s.RestSeconds, s.Tempo, s.LoadText, s.Notes)).ToList())).ToList())).ToList(), null);
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
        import.Status = ImportStatus.Discarded; import.DraftJson = ""; import.Revision++;
        await db.SaveChangesAsync(ct);
    }

    public async Task ValidateDraft(ImportDraft draft, CancellationToken ct)
    {
        Validation.Name(draft.ProgramName, "Program name");
        Validation.Text(draft.Description, 4000, "Program description");
        Validation.Require(draft.Workouts is { Count: > 0 and <= 200 }, "A program needs between 1 and 200 workouts.");
        Validation.Require(draft.Workouts.All(w => w.Week is > 0 and <= 104), "Program weeks must be between 1 and 104.");
        foreach (var workout in draft.Workouts)
        {
            Validation.Name(workout.Name, "Workout name");
            Validation.Text(workout.Focus, 120, "Focus"); Validation.Text(workout.Notes, 2000, "Workout notes");
            Validation.Require(workout.Exercises is { Count: > 0 and <= 40 }, "Each workout needs between 1 and 40 exercises.");
            foreach (var exercise in workout.Exercises)
            {
                Validation.Name(exercise.SourceName, "Exercise name", 160);
                Validation.Text(exercise.Notes, 1000, "Exercise notes");
                Validation.Prescriptions(exercise.Sets.Select(s => new SetPrescription(s.RepMin, s.RepMax, s.TargetRpe, s.RestSeconds, s.Tempo, s.LoadText, s.Notes)).ToList());
                foreach (var set in exercise.Sets)
                    foreach (var source in new[] { set.RepsSource, set.RpeSource, set.RestSource })
                        Validation.Require(source is "extracted" or "inferred" or "userEdited", "Unknown provenance label.");
                await catalog.RequireActive(exercise.ExerciseId, ct);
            }
        }
    }

    private async Task Meter(CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var usage = await db.Usage.SingleOrDefaultAsync(u => u.Date == today, ct);
        if (usage == null) { usage = new AiUsage { UserId = db.CurrentUser!.Value, Date = today, Count = 0 }; db.Usage.Add(usage); }
        Validation.Require(usage.Count < DailyLimit, $"You have used all {DailyLimit} AI imports for today. Manual program building remains available.", 429);
        usage.Count++;
        await db.SaveChangesAsync(ct);
    }
}
