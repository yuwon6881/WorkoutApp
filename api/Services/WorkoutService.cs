using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record SetInput(double? WeightKg, int? Reps, double? Rpe, bool Done, bool Warmup = false,
    string? ResistanceMode = null, Guid? Id = null);
public record SessionExerciseInput(Guid? ExerciseId, string NameSnapshot, string? Note, List<SetPrescription> Prescription, List<SetInput> Sets,
    string? SequenceGroup = null, List<string>? Substitutions = null, string? LoadModel = null, Guid? Id = null,
    Guid? SourceTemplateExerciseId = null, Guid? SourceSlotKey = null, Guid? SourcePhaseId = null, int? SourcePage = null,
    int? RestSeconds = null);
public record SessionInput(string? Note, List<SessionExerciseInput> Exercises, int? Revision, Guid? IdempotencyId);
public record SetView(Guid Id, int Position, double? WeightKg, int? Reps, double? Rpe, bool Done, bool Warmup = false,
    int? WorkingSetOrdinal = null, string ResistanceMode = ResistanceModes.External, double? SystemLoadKg = null,
    SetProgressionSuggestion? Suggestion = null, bool IsPr = false, double? Estimated1RmKg = null);
public record SessionExerciseView(Guid Id, Guid? ExerciseId, string Name, int Position, string Note, List<SetPrescription> Prescription, List<SetView> Sets,
    string SequenceGroup = "", List<string>? Substitutions = null, ProgressionView? Progression = null,
    string LoadModel = LoadModels.External, Guid? SourceTemplateExerciseId = null, Guid? SourceSlotKey = null, Guid? SourcePhaseId = null,
    Guid? SwapGroupKey = null, bool IsReplacement = false, Guid? OriginalExerciseId = null, string OriginalName = "", int? SourcePage = null,
    bool CanRestore = false, int? RestSeconds = null, string? DemoUrl = null, bool IsPr = false, double? PrE1rmKg = null);
public record SessionView(Guid Id, Guid? TemplateId, Guid? ProgramId, string Name, string Note, bool Active, DateTime StartedAt, DateTime? FinishedAt, int Revision,
    List<SessionExerciseView> Exercises, double? VolumeKg, int CompletedSets, int WarmupSets = 0,
    BodyWeightSnapshot? BodyWeight = null, NutritionTrainingContext? NutritionContext = null,
    double? SystemVolumeKg = null, DateTime? PausedAt = null, long PausedSeconds = 0, int PrCount = 0);

public sealed record WorkoutActivityItem(Guid Id, string Name, string Status, DateOnly Date);

public record SessionSubstitutionInput(Guid SessionExerciseId, Guid? ReplacementExerciseId, string ReplacementName,
    int? Revision, Guid? IdempotencyId);

public sealed partial class WorkoutService(
    AppDb db,
    CatalogService catalog,
    TemplateService templates,
    ProgressionService progression,
    NutritionContextService nutrition,
    ProgramService programs,
    GoogleHealthWorkoutSyncService? workoutSync = null)
{
    // Keep the pre-phase constructor usable for integrations and focused tests that create the
    // service directly. The application container resolves the primary constructor above.
    public WorkoutService(AppDb db, CatalogService catalog, TemplateService templates,
        ProgressionService progression, NutritionContextService nutrition)
        : this(db, catalog, templates, progression, nutrition, CreateProgramService(db, templates), null)
    {
    }

    private static ProgramService CreateProgramService(AppDb db, TemplateService templates)
    {
        var progress = new ProgramProgressService(db);
        return new ProgramService(db, templates, progress, new ProgramLifecycleService(db, templates, progress));
    }

    public async Task<SessionView?> Active(CancellationToken ct)
    {
        var session = await db.Workouts.AsNoTracking().SingleOrDefaultAsync(w => w.Active, ct);
        return session == null ? null : await View(session, ct);
    }

    public async Task<SessionView> Get(Guid id, CancellationToken ct)
    {
        var session = await db.Workouts.AsNoTracking().SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        return await View(session!, ct);
    }

    public async Task<SessionView> View(WorkoutSession session, CancellationToken ct)
    {
        return (await Views([session], ct))[session.Id];
    }

    /// Loads a collection of sessions with one exercise query and one set query.
    /// History and training-summary pages used to call View once per row, which
    /// multiplied the same two database round trips by the page size.
    public async Task<Dictionary<Guid, SessionView>> Views(IReadOnlyList<WorkoutSession> sessions, CancellationToken ct)
    {
        if (sessions.Count == 0) return [];
        var sessionIds = sessions.Select(s => s.Id).ToList();
        var exercises = await db.SessionExercises.AsNoTracking()
            .Where(e => sessionIds.Contains(e.SessionId)).OrderBy(e => e.SessionId).ThenBy(e => e.Position).ToListAsync(ct);
        var exerciseIds = exercises.Select(e => e.Id).ToList();
        var sets = exerciseIds.Count == 0 ? [] : await db.Sets.AsNoTracking()
            .Where(s => exerciseIds.Contains(s.SessionExerciseId)).OrderBy(s => s.Position).ToListAsync(ct);

        return await WorkoutViewBuilder.BuildViews(db, sessions, exercises, sets, ct);
    }


    /// Start-time snapshots are the contract: all set suggestions and Nutrition context are made
    /// once here, then saved on the session so later settings/history changes cannot rewrite them.
    public async Task<SessionView> Start(Guid? templateId, string? name, CancellationToken ct)
    {
        // Nutrition is advisory and may require a peer HTTP/KMS round trip. Resolve it before
        // taking the account mutation lock so a slow provider cannot block saves, finishes, or
        // another tab. The active-workout and template checks below are repeated under the lock;
        // the context is frozen only after those authoritative checks succeed.
        var contextResult = await nutrition.Get(ct);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        Validation.Require(!await db.Workouts.AnyAsync(w => w.Active, ct), "Finish or discard your current workout before starting another.", 409);
        WorkoutTemplate? template = null;
        Guid? programDayProgressId = null;
        if (templateId is { } id)
        {
            template = await db.Templates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, ct);
            Validation.Require(template != null, "That workout plan no longer exists.", 404);
            Validation.Require(!template!.IsRestDay, "That slot is a rest day.", 409);
            if (template.ProgramId is { } programId)
            {
                var day = await programs.PendingWorkoutDay(programId, template.Id, ct);
                programDayProgressId = day.Id;
            }
        }
        else Validation.Name(name, "Workout name");

        var context = contextResult.Context;
        var bodyWeight = ChooseBodyWeight(context);
        var session = new WorkoutSession
        {
            UserId = db.CurrentUser!.Value,
            TemplateId = template?.Id,
            ProgramId = template?.ProgramId,
            ProgramDayProgressId = programDayProgressId,
            Name = template?.Name ?? name!.Trim(),
            Active = true,
            BodyWeightSnapshotJson = bodyWeight is null ? "" : Json.Write(bodyWeight),
            NutritionContextJson = context is null ? "" : Json.Write(context),
            NutritionContextRevision = context?.Revision
        };
        db.Workouts.Add(session);

        if (template != null)
        {
            var planned = await db.TemplateExercises.AsNoTracking().Where(e => e.TemplateId == template.Id).OrderBy(e => e.Position).ToListAsync(ct);
            var names = await templates.CatalogNames(planned.Select(p => p.ExerciseId), ct);
            var info = await progression.LoadInfo(planned.Select(p => p.ExerciseId), ct);
            var models = await catalog.LoadModelsFor(planned.Select(p => p.ExerciseId), ct);
            var histories = await PreviousExposuresBatch(planned.Select(p => (p.ExerciseId, p.SourceName)), ct);
            foreach (var plan in planned)
            {
                var prescription = Json.Read<List<SetPrescription>>(plan.SetsJson);
                var resolvedName = plan.ExerciseId is { } catalogId && names.TryGetValue(catalogId, out var resolved) ? resolved : plan.SourceName;
                var loadModel = plan.ExerciseId is { } modelId && info.TryGetValue(modelId, out _)
                    ? models.GetValueOrDefault(modelId, LoadModels.External) : LoadModels.External;
                var exercise = new SessionExercise
                {
                    UserId = session.UserId, SessionId = session.Id, ExerciseId = plan.ExerciseId, Position = plan.Position,
                    NameSnapshot = resolvedName, Note = plan.Note, PrescriptionJson = Json.Write(prescription), SequenceGroup = plan.SequenceGroup,
                    RestSeconds = plan.RestSeconds,
                    SubstitutionsJson = plan.SubstitutionsJson, LoadModel = loadModel,
                    SourceTemplateExerciseId = plan.Id, SourceSlotKey = plan.SlotKey, SourcePhaseId = template.ProgramPhaseId, SourcePage = plan.SourcePage,
                    DemoUrl = plan.DemoUrl, DemoLinksJson = plan.DemoLinksJson
                };
                db.SessionExercises.Add(exercise);

                var historyKey = (plan.ExerciseId, plan.ExerciseId is null ? CatalogService.Normalize(plan.SourceName) : "");
                var previous = histories.GetValueOrDefault(historyKey) ?? [];
                var step = plan.ExerciseId is { } id2 && info.TryGetValue(id2, out var found) ? found.StepKg : Progression.DefaultStepKg;
                var workingOrdinal = 0;
                var firstSuggestion = (SetProgressionSuggestion?)null;
                for (var index = 0; index < prescription.Count; index++)
                {
                    var planSet = prescription[index];
                    if (planSet.Warmup)
                    {
                        db.Sets.Add(new CompletedSet
                        {
                            UserId = session.UserId, SessionExerciseId = exercise.Id, Position = index,
                            Reps = planSet.RepMin, Rpe = null, Done = false, Warmup = true,
                            ResistanceMode = ResistanceModes.Bodyweight
                        });
                        continue;
                    }

                    workingOrdinal++;
                    var resistanceMode = ResolveResistanceMode(loadModel, planSet.ResistanceMode);
                    var exposures = previous.GetValueOrDefault(workingOrdinal) ?? [];
                    var suggestion = MakeSuggestion(planSet, exposures, contextResult.Mode, step, contextResult, resistanceMode, loadModel, bodyWeight);
                    firstSuggestion ??= suggestion;
                    db.Sets.Add(new CompletedSet
                    {
                        UserId = session.UserId, SessionExerciseId = exercise.Id, Position = index,
                        WorkingSetOrdinal = workingOrdinal, WeightKg = suggestion.SuggestedLoadKg,
                        Reps = suggestion.SuggestedReps, Rpe = null, Done = false, Warmup = false,
                        SuggestionJson = Json.Write(suggestion), ResistanceMode = resistanceMode,
                        SystemLoadKg = suggestion.SuggestedSystemLoadKg
                    });
                }
                // Legacy summary consumers see the first working set, while every set has its own
                // authoritative snapshot in SuggestionJson.
                exercise.ProgressionJson = firstSuggestion is null ? "" : Json.Write(new ProgressionView(
                    firstSuggestion.SuggestedLoadKg, firstSuggestion.SuggestedReps, firstSuggestion.Reason,
                    null, null, step, firstSuggestion.ProgressionMode, firstSuggestion.NutritionContextRevision));
                exercise.BaselineJson = CreateExerciseBaseline(exercise, db.Sets.Local.Where(s => s.SessionExerciseId == exercise.Id));
            }
        }
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(session.Id, ct);
    }

    private SetProgressionSuggestion MakeSuggestion(SetPrescription prescription, IReadOnlyList<SetExposure> exposures,
        string mode, double step, NutritionContextResult context, string resistanceMode, string loadModel,
        BodyWeightSnapshot? bodyWeight)
    {
        if (loadModel == LoadModels.FullBodyweight)
        {
            var baseSuggestion = Progression.SuggestSet(prescription.RepMin, prescription.RepMax, prescription.TargetRpe,
                exposures, mode, step, context.Context?.Revision, resistanceMode,
                // A historical full-bodyweight set without a frozen snapshot cannot support a
                // system-load calculation. Never reinterpret its entered added/assistance load
                // as kilograms of total resistance.
                exposure => exposure.SystemLoadKg);
            var system = baseSuggestion.SuggestedLoadKg;
            var input = ToInputLoad(system, bodyWeight?.ReferenceKg, resistanceMode, step);
            var actualSystem = RecomputeSystemLoad(input, bodyWeight?.ReferenceKg, resistanceMode) ?? system;
            var adjusted = actualSystem is not null && exposures.FirstOrDefault()?.SystemLoadKg is { } previousSystem &&
                Math.Abs(previousSystem - actualSystem.Value) < .0001 && bodyWeight?.ReferenceKg is not null;
            var reason = adjusted ? "Bodyweight adjustment: keep the previous system-load target at your current reference bodyweight." : baseSuggestion.Reason;
            return baseSuggestion with
            {
                SuggestedLoadKg = input,
                SuggestedSystemLoadKg = actualSystem,
                Reason = reason,
                IsBodyweightAdjustment = adjusted,
                ResistanceMode = resistanceMode
            };
        }

        var policyMode = loadModel is LoadModels.BodyweightContextOnly or LoadModels.RepsOnly ? ResistanceModes.RepsOnly : resistanceMode;
        return Progression.SuggestSet(prescription.RepMin, prescription.RepMax, prescription.TargetRpe, exposures, mode, step,
            context.Context?.Revision, policyMode) with { ResistanceMode = resistanceMode };
    }

    private static double? ToInputLoad(double? systemLoad, double? reference, string resistanceMode, double step)
    {
        if (systemLoad is null || reference is null) return null;
        return resistanceMode switch
        {
            ResistanceModes.Added => Progression.RoundToStep(Math.Max(0, systemLoad.Value - reference.Value), step),
            ResistanceModes.Assistance => Progression.RoundToStep(Math.Max(0, reference.Value - systemLoad.Value), step),
            _ => null
        };
    }

    private static double? RecomputeSystemLoad(double? input, double? reference, string resistanceMode)
    {
        if (reference is not { } bodyweight) return null;
        return resistanceMode switch
        {
            ResistanceModes.Bodyweight => bodyweight,
            ResistanceModes.Added when input is { } added => bodyweight + added,
            ResistanceModes.Assistance when input is { } assistance => Math.Max(0, bodyweight - assistance),
            _ => null
        };
    }

    private static string ResolveResistanceMode(string loadModel, string requested)
    {
        if (loadModel == LoadModels.FullBodyweight)
            return requested is ResistanceModes.Added or ResistanceModes.Assistance or ResistanceModes.Bodyweight ? requested : ResistanceModes.Bodyweight;
        if (loadModel is LoadModels.BodyweightContextOnly or LoadModels.RepsOnly) return ResistanceModes.RepsOnly;
        return ResistanceModes.External;
    }

    private static BodyWeightSnapshot? ChooseBodyWeight(NutritionTrainingContext? context)
    {
        if (context is null || !context.Confirmed) return null;
        var now = DateTime.UtcNow;
        var zone = SafeZone(context.TimeZone);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(now, zone));
        var sameDayScale = context.ScaleWeightKg is not null && context.ScaleWeightDate == today;
        var recentTrend = context.TrendWeightKg is not null && context.TrendWeightDate is { } trendDate && trendDate >= today.AddDays(-7) && trendDate <= today;
        var source = sameDayScale ? "scale" : recentTrend ? "trend" : null;
        var reference = sameDayScale ? context.ScaleWeightKg : recentTrend ? context.TrendWeightKg : null;
        if (reference is null) return null;
        return new BodyWeightSnapshot(context.ScaleWeightKg, context.ScaleWeightDate, context.TrendWeightKg, context.TrendWeightDate,
            reference, source, sameDayScale ? context.ScaleWeightDate : context.TrendWeightDate, "bodyweight-context-v1",
            context.Revision, now);
    }

    private static TimeZoneInfo SafeZone(string zone)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(zone); }
        catch { return TimeZoneInfo.Utc; }
    }

    private static bool BelongsToPhase(WorkoutTemplate template, ProgramPhase phase)
    {
        if (!string.Equals(template.Block.Trim(), phase.Block.Trim(), StringComparison.OrdinalIgnoreCase)) return false;
        if (!string.IsNullOrWhiteSpace(template.Phase))
            return string.Equals(template.Phase.Trim(), phase.Name.Trim(), StringComparison.OrdinalIgnoreCase);
        return string.IsNullOrWhiteSpace(phase.Block) ||
            string.Equals(phase.Name.Trim(), phase.Block.Trim(), StringComparison.OrdinalIgnoreCase) ||
            string.Equals(phase.Name.Trim(), "Program", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPhaseComplete(ProgramPhase phase, IEnumerable<WorkoutTemplate> rows,
        IReadOnlySet<Guid> completed, IReadOnlySet<Guid> skipped)
    {
        var ids = rows.Where(template => !template.IsRestDay && template.Week >= phase.WeekFrom && template.Week <= phase.WeekTo && BelongsToPhase(template, phase)).Select(template => template.Id).ToList();
        if (ids.Count > 0) return ids.All(id => completed.Contains(id) || skipped.Contains(id));
        return true;
    }

    public async Task<SessionView> Save(Guid id, SessionInput input, CancellationToken ct)
    {
        var requestHash = Fingerprint(input);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        var sessionRow = session!;
        var replay = await ReplayWorkoutMutation(id, input.IdempotencyId, "workout.save", requestHash, ct);
        if (replay is not null)
        {
            await gate.Commit(ct);
            return replay;
        }

        Validation.Text(input.Note, 4000, "Workout notes");
        Validation.Require(input.Exercises is { Count: <= 40 }, "A workout can have at most 40 exercises.");
        foreach (var exercise in input.Exercises)
        {
            Validation.Name(exercise.NameSnapshot, "Exercise name", 160);
            Validation.Text(exercise.Note, 1000, "Exercise notes");
            Validation.ExerciseRestSeconds(exercise.RestSeconds);
            Validation.Prescriptions(exercise.Prescription);
            Validation.Require(exercise.Sets is { Count: <= 24 }, "An exercise can have at most 24 sets.");
            Validation.Substitutions(exercise.Substitutions);
            foreach (var set in exercise.Sets)
            {
                Validation.LoggedSet(set.WeightKg, set.Reps, set.Rpe, set.Done, set.Warmup);
                Validation.Require(set.ResistanceMode is null || ResistanceModes.All.Contains(set.ResistanceMode), "Unknown resistance mode.");
            }
            await catalog.RequireActive(exercise.ExerciseId, ct);
        }

        Validation.Require(sessionRow.Active, "This workout is already saved to your history.", 409);
        TemplateService.RequireFresh(input.Revision, sessionRow.Revision);
        sessionRow.Note = input.Note?.Trim() ?? ""; sessionRow.Revision++;

        var existing = await db.SessionExercises.Where(e => e.SessionId == id).ToListAsync(ct);
        var existingIds = existing.Select(e => e.Id).ToList();
        var oldSets = await db.Sets.Where(s => existingIds.Contains(s.SessionExerciseId)).ToListAsync(ct);
        var stableIds = input.Exercises.Any(e => e.Id is not null || e.Sets.Any(s => s.Id is not null));
        var existingById = existing.ToDictionary(e => e.Id);
        var oldSetsById = oldSets.ToDictionary(s => s.Id);
        var legacySuggestions = existing.SelectMany(e => oldSets.Where(s => s.SessionExerciseId == e.Id).Select(s => (Key: ProgressionService.Key(e.ExerciseId, e.NameSnapshot), s.Position, Set: s)))
            .GroupBy(x => (x.Key, x.Position)).ToDictionary(g => g.Key, g => g.First().Set);
        var usedExercises = new HashSet<Guid>();
        var usedSets = new HashSet<Guid>();

        var catalogModels = await catalog.LoadModelsFor(input.Exercises.Select(e => e.ExerciseId), ct);
        var catalogInfo = await progression.LoadInfo(input.Exercises.Select(e => e.ExerciseId), ct);
        var position = 0;
        foreach (var exercise in input.Exercises)
        {
            var loadModel = exercise.ExerciseId is { } catalogId ? catalogModels.GetValueOrDefault(catalogId, LoadModels.External) : LoadModels.External;
            var step = exercise.ExerciseId is { } stepId && catalogInfo.TryGetValue(stepId, out var exerciseInfo)
                ? exerciseInfo.StepKg : Progression.DefaultStepKg;
            var key = ProgressionService.Key(exercise.ExerciseId, exercise.NameSnapshot.Trim());
            var row = exercise.Id is { } exerciseId && existingById.TryGetValue(exerciseId, out var stableExercise)
                ? stableExercise
                : stableIds ? null : existing.Where(candidate => !usedExercises.Contains(candidate.Id))
                    .FirstOrDefault(candidate => ProgressionService.Key(candidate.ExerciseId, candidate.NameSnapshot) == key);
            row ??= new SessionExercise { UserId = sessionRow.UserId, SessionId = id };
            usedExercises.Add(row.Id);
            row.ExerciseId = exercise.ExerciseId; row.Position = position++;
            row.NameSnapshot = exercise.NameSnapshot.Trim(); row.Note = exercise.Note?.Trim() ?? "";
            row.PrescriptionJson = Json.Write(exercise.Prescription);
            row.SequenceGroup = exercise.SequenceGroup?.Trim() ?? "";
            row.RestSeconds = exercise.RestSeconds;
            row.SubstitutionsJson = Json.Write((exercise.Substitutions ?? []).Take(2).Select(s => s.Trim()).ToList());
            row.LoadModel = loadModel;
            row.SourceTemplateExerciseId = exercise.SourceTemplateExerciseId ?? row.SourceTemplateExerciseId;
            row.SourceSlotKey = exercise.SourceSlotKey ?? row.SourceSlotKey;
            row.SourcePhaseId = exercise.SourcePhaseId ?? row.SourcePhaseId;
            row.SourcePage = exercise.SourcePage ?? row.SourcePage;
            if (string.IsNullOrWhiteSpace(row.ProgressionJson)) row.ProgressionJson = "";
            if (row.UserId == sessionRow.UserId && !existingById.ContainsKey(row.Id)) db.SessionExercises.Add(row);
            var setsForRow = oldSets.Where(set => set.SessionExerciseId == row.Id).ToDictionary(set => set.Id);
            var setPosition = 0;
            var workingOrdinal = setsForRow.Values.Max(set => set.WorkingSetOrdinal) ?? 0;
            foreach (var set in exercise.Sets)
            {
                var old = set.Id is { } setId && setsForRow.TryGetValue(setId, out var stableSet)
                    ? stableSet
                    : stableIds ? null : legacySuggestions.GetValueOrDefault((key, setPosition));
                var isWorking = !set.Warmup;
                var ordinal = isWorking
                    ? old?.WorkingSetOrdinal ?? ++workingOrdinal
                    : (int?)null;
                if (ordinal is { } persistedOrdinal) workingOrdinal = Math.Max(workingOrdinal, persistedOrdinal);
                var resistanceMode = ResolveResistanceMode(loadModel, set.ResistanceMode ?? old?.ResistanceMode ?? ResistanceModes.External);
                var enteredLoad = NormalizeEnteredLoad(loadModel, resistanceMode, set.WeightKg, step);
                var updated = old ?? new CompletedSet { UserId = sessionRow.UserId, SessionExerciseId = row.Id, SuggestionJson = "" };
                updated.SessionExerciseId = row.Id; updated.Position = setPosition++; updated.WeightKg = enteredLoad;
                updated.Reps = set.Reps; updated.Rpe = set.Rpe; updated.Done = set.Done; updated.Warmup = set.Warmup;
                updated.WorkingSetOrdinal = ordinal;
                updated.ResistanceMode = resistanceMode;
                updated.SystemLoadKg = ComputeSystemLoad(sessionRow, loadModel, resistanceMode, enteredLoad);
                usedSets.Add(updated.Id);
                if (!oldSetsById.ContainsKey(updated.Id)) db.Sets.Add(updated);
            }
        }
        db.Sets.RemoveRange(oldSets.Where(set => !usedSets.Contains(set.Id)));
        db.SessionExercises.RemoveRange(existing.Where(exercise => !usedExercises.Contains(exercise.Id)));
        await RecordWorkoutMutation(input.IdempotencyId, id, "workout.save", requestHash, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    /// Swap an exercise in the running session while preserving the source slot and all completed
    /// history. When the exercise is partially complete the unfinished sets move to a second row;
    /// the UI can therefore render one logical slot with an original and a continuation.
    public async Task<SessionView> Swap(Guid id, SessionSubstitutionInput input, CancellationToken ct)
    {
        var requestHash = Fingerprint(input);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        var swapSession = session!;
        var replay = await ReplayWorkoutMutation(id, input.IdempotencyId, "workout.exercise.substitute", requestHash, ct);
        if (replay is not null)
        {
            await gate.Commit(ct);
            return replay;
        }
        Validation.Require(swapSession.Active, "This workout is already saved to your history.", 409);
        TemplateService.RequireFresh(input.Revision, swapSession.Revision);
        Validation.Name(input.ReplacementName, "Replacement exercise", 160);
        await catalog.RequireActive(input.ReplacementExerciseId, ct);
        var source = await db.SessionExercises.SingleOrDefaultAsync(e => e.Id == input.SessionExerciseId && e.SessionId == id, ct);
        Validation.Require(source != null, "That exercise is no longer in this workout.", 404);
        var sourceRow = source!;
        var replacementName = input.ReplacementName.Trim();
        if (input.ReplacementExerciseId is { } replacementId)
            replacementName = await catalog.NameFor(replacementId, ct);
        var replacementModel = input.ReplacementExerciseId is { } modelId
            ? (await catalog.LoadModelsFor([modelId], ct)).GetValueOrDefault(modelId, LoadModels.External)
            : LoadModels.External;
        var sets = await db.Sets.Where(s => s.SessionExerciseId == sourceRow.Id).OrderBy(s => s.Position).ToListAsync(ct);
        Validation.Require(!sets.Any(s => s.Done), "Cannot swap an exercise after completing sets.", 409);
        var groupKey = sourceRow.SwapGroupKey ?? Guid.NewGuid();
        sourceRow.SwapGroupKey = groupKey;
        sourceRow.OriginalExerciseId ??= sourceRow.ExerciseId;
        if (string.IsNullOrWhiteSpace(sourceRow.OriginalNameSnapshot)) sourceRow.OriginalNameSnapshot = sourceRow.NameSnapshot;
        sourceRow.ExerciseId = input.ReplacementExerciseId;
        sourceRow.NameSnapshot = replacementName;
        sourceRow.DemoUrl = ImportDemoLinks.ForName(
            Json.Read<Dictionary<string, string>>(sourceRow.DemoLinksJson), replacementName) ?? "";
        sourceRow.LoadModel = replacementModel;
        sourceRow.ProgressionJson = "";
        sourceRow.IsReplacement = true;
        foreach (var set in sets) ClearUnfinishedSet(set, replacementModel);
        await RefreshReplacementSuggestions(swapSession, sourceRow, sets, replacementModel, ct);
        db.ExerciseSubstitutions.Add(new ExerciseSubstitution
        {
            UserId = swapSession.UserId, SessionId = swapSession.Id, SourceTemplateExerciseId = sourceRow.SourceTemplateExerciseId,
            SourceSlotKey = sourceRow.SourceSlotKey, SourcePhaseId = sourceRow.SourcePhaseId, OriginalExerciseId = sourceRow.OriginalExerciseId,
            OriginalName = sourceRow.OriginalNameSnapshot, ReplacementExerciseId = input.ReplacementExerciseId, ReplacementName = replacementName,
            Scope = sourceRow.SourcePhaseId is null ? "slot" : "phase", PendingRetention = sourceRow.SourcePhaseId is not null
        });
        swapSession.Revision++;
        await RecordWorkoutMutation(input.IdempotencyId, id, "workout.exercise.substitute", requestHash, ct);
        await db.SaveChangesAsync(ct); await gate.Commit(ct);
        return await Get(id, ct);
    }

    private static void ClearUnfinishedSet(CompletedSet set, string replacementModel)
    {
        set.WeightKg = null; set.SystemLoadKg = null; set.SuggestionJson = "";
        set.ResistanceMode = ResolveResistanceMode(replacementModel, set.ResistanceMode);
    }

    private async Task RefreshReplacementSuggestions(WorkoutSession session, SessionExercise exercise, List<CompletedSet> sets,
        string loadModel, CancellationToken ct)
    {
        var prescriptions = Json.Read<List<SetPrescription>>(exercise.PrescriptionJson);
        var context = ReadOptional<NutritionTrainingContext>(session.NutritionContextJson);
        var result = new NutritionContextResult(context, NutritionContextService.Mode(context, DateTime.UtcNow), context is not null, context?.Confirmed == true, null);
        var bodyWeight = ReadOptional<BodyWeightSnapshot>(session.BodyWeightSnapshotJson);
        var info = await progression.LoadInfo([exercise.ExerciseId], ct);
        var step = exercise.ExerciseId is { } id && info.TryGetValue(id, out var found) ? found.StepKg : Progression.DefaultStepKg;
        var histories = await PreviousExposures(exercise.ExerciseId, exercise.NameSnapshot, ct);
        var workingOrdinal = 0; SetProgressionSuggestion? first = null;
        foreach (var set in sets.OrderBy(s => s.Position))
        {
            if (set.Warmup) continue;
            workingOrdinal++;
            var prescription = prescriptions.ElementAtOrDefault(set.Position);
            if (prescription is null) continue;
            var enteredReps = set.Reps;
            var enteredRpe = set.Rpe;
            var mode = ResolveResistanceMode(loadModel, prescription.ResistanceMode);
            var suggestion = MakeSuggestion(prescription, histories.GetValueOrDefault(workingOrdinal) ?? [], result.Mode, step, result, mode, loadModel, bodyWeight);
            set.WeightKg = suggestion.SuggestedLoadKg; set.SystemLoadKg = suggestion.SuggestedSystemLoadKg;
            set.ResistanceMode = mode; set.SuggestionJson = Json.Write(suggestion); set.Reps = enteredReps; set.Rpe = enteredRpe; first ??= suggestion;
        }
        exercise.ProgressionJson = first is null ? "" : Json.Write(new ProgressionView(first.SuggestedLoadKg, first.SuggestedReps, first.Reason,
            null, null, step, first.ProgressionMode, first.NutritionContextRevision));
    }

    /// Finishing keeps only completed sets, so an untouched suggestion never becomes history.
    public async Task<SessionView> Finish(Guid id, int? revision, CancellationToken ct, bool retainExerciseSwaps = false,
        Guid? mutationId = null, DateTimeOffset? finishedAt = null)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        var finishRequest = new FinishMutation(revision, retainExerciseSwaps, finishedAt?.ToUniversalTime());
        var requestHash = Fingerprint(finishRequest);
        var replay = await ReplayWorkoutMutation(id, mutationId, "workout.finish", requestHash, ct);
        if (replay is not null)
        {
            await gate.Commit(ct);
            return replay;
        }
        Validation.Require(session!.Active, "This workout is already saved to your history.", 409);
        Validation.Require(mutationId is null || mutationId != Guid.Empty, "The mutation identity is invalid.");
        Validation.Require(finishedAt is null || mutationId is not null,
            "A client-provided finish time requires an operation identity.");
        TemplateService.RequireFresh(revision, session.Revision);
        var completedAt = ResolveFinishedAt(session, finishedAt);
        Validation.Require(session.LastTimingEventAt is null || completedAt >= session.LastTimingEventAt,
            "The finish time must follow the last pause or resume.", 409);
        var exercises = await db.SessionExercises.Where(e => e.SessionId == id).ToListAsync(ct);
        var ids = exercises.Select(e => e.Id).ToList();
        var sets = await db.Sets.Where(s => ids.Contains(s.SessionExerciseId)).ToListAsync(ct);
        Validation.Require(sets.Any(s => s.Done), "Complete at least one set to save this workout.");
        db.Sets.RemoveRange(sets.Where(s => !s.Done));
        foreach (var exercise in exercises.Where(e => !sets.Any(s => s.Done && s.SessionExerciseId == e.Id))) db.SessionExercises.Remove(exercise);

        var pending = await db.ExerciseSubstitutions.Where(s => s.SessionId == id && s.PendingRetention).ToListAsync(ct);
        if (retainExerciseSwaps)
            await RetainPendingSwaps(pending, session.TemplateId, ct);
        foreach (var record in pending)
        {
            record.PendingRetention = false;
            if (retainExerciseSwaps && record.SourcePhaseId is not null) record.RetainedAt = DateTime.UtcNow;
        }

        // The legacy estimate remains useful for charts; use effective system load for a full
        // bodyweight set and entered load for external/reps-only work.
        await progression.Record(exercises.Select(e => (e.ExerciseId, e.NameSnapshot,
            sets.Where(s => s.SessionExerciseId == e.Id && s.Done && !s.Warmup).OrderBy(s => s.Position)
                .Select(s => new PreviousSet(e.LoadModel == LoadModels.FullBodyweight ? s.SystemLoadKg : s.WeightKg, s.Reps, s.Rpe)).ToList())).ToList(), ct);

        if (session.PausedAt is { } pauseStart)
        {
            Validation.Require(completedAt >= pauseStart, "The finish time must follow the pause start.", 409);
            session.PausedSeconds += (long)Math.Round((completedAt - pauseStart).TotalSeconds, MidpointRounding.AwayFromZero);
            session.PausedAt = null;
        }
        session.Active = false; session.FinishedAt = completedAt; session.LastTimingEventAt = completedAt; session.Revision++;
        await RecordWorkoutMutation(mutationId, id, "workout.finish", requestHash, ct);
        await db.SaveChangesAsync(ct);
        if (session.ProgramId is not null) await programs.CompleteWorkout(session, ct);
        if (workoutSync is not null) await workoutSync.QueueWorkoutAsync(id, isDelete: false, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    private async Task RetainPendingSwaps(List<ExerciseSubstitution> pending, Guid? currentTemplateId, CancellationToken ct)
    {
        foreach (var swap in pending.Where(s => s.SourcePhaseId is not null))
        {
            var phase = await db.ProgramPhases.AsNoTracking().SingleOrDefaultAsync(p => p.Id == swap.SourcePhaseId, ct);
            if (phase is null) continue;
            var templatesInPhase = await db.Templates.Where(t => t.ProgramId == phase.ProgramId && !t.IsRestDay &&
                t.Week >= phase.WeekFrom && t.Week <= phase.WeekTo &&
                (t.ProgramPhaseId == swap.SourcePhaseId || (t.ProgramPhaseId == null && t.Block == phase.Block &&
                    (t.Phase == phase.Name || (string.IsNullOrWhiteSpace(t.Phase) && phase.Name == phase.Block))))).ToListAsync(ct);
            var sourcePosition = swap.SourceTemplateExerciseId is { } sourceId
                ? await db.TemplateExercises.Where(e => e.Id == sourceId).Select(e => (int?)e.Position).SingleOrDefaultAsync(ct)
                : null;
            var completed = await db.Workouts.Where(w => w.FinishedAt != null && w.TemplateId != null)
                .Select(w => w.TemplateId!.Value).ToHashSetAsync(ct);
            var skipped = await db.ProgramSkips.Where(s => templatesInPhase.Select(t => t.ProgramId).Contains(s.ProgramId))
                .Select(s => s.TemplateId).ToHashSetAsync(ct);
            foreach (var template in templatesInPhase.Where(t => !completed.Contains(t.Id) && !skipped.Contains(t.Id)))
            {
                if (currentTemplateId == template.Id) continue;
                var row = await db.TemplateExercises.SingleOrDefaultAsync(e => e.TemplateId == template.Id &&
                    (e.SlotKey == swap.SourceSlotKey || (sourcePosition.HasValue && e.Position == sourcePosition.Value)), ct);
                if (row is null) continue;
                row.ExerciseId = swap.ReplacementExerciseId; row.SourceName = swap.ReplacementName;
                row.DemoUrl = ImportDemoLinks.ForName(
                    Json.Read<Dictionary<string, string>>(row.DemoLinksJson), swap.ReplacementName) ?? "";
                template.Revision++;
            }
        }
    }

    public async Task Discard(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        Validation.Require(session!.Active, "A saved workout is deleted from your history, not discarded.", 409);
        await Remove(session!, ct); await db.SaveChangesAsync(ct); await gate.Commit(ct);
    }

    public async Task DeleteFromHistory(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id && !w.Active, ct);
        Validation.Require(session != null, "That workout is not in your history.", 404);
        if (workoutSync is not null) await workoutSync.QueueWorkoutAsync(id, isDelete: true, ct);
        await Remove(session!, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task Remove(WorkoutSession session, CancellationToken ct)
    {
        var ids = await db.SessionExercises.Where(e => e.SessionId == session.Id).Select(e => e.Id).ToListAsync(ct);
        db.Sets.RemoveRange(await db.Sets.Where(s => ids.Contains(s.SessionExerciseId)).ToListAsync(ct));
        db.SessionExercises.RemoveRange(await db.SessionExercises.Where(e => e.SessionId == session.Id).ToListAsync(ct));
        db.ExerciseSubstitutions.RemoveRange(await db.ExerciseSubstitutions.Where(s => s.SessionId == session.Id).ToListAsync(ct));
        db.Workouts.Remove(session);
    }

    public async Task<HistoryPage> History(int page, int size, CancellationToken ct)
    {
        Validation.Require(page >= 0 && size is > 0 and <= 100, "Invalid page request.");
        var query = db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null).OrderByDescending(w => w.FinishedAt);
        var total = await query.CountAsync(ct);
        var rows = await query.Skip(page * size).Take(size).ToListAsync(ct);
        var byId = await Views(rows, ct);
        var views = rows.Select(row => byId[row.Id]).ToList();
        return new HistoryPage(total, page, size, views);
    }

    public async Task<HistoryCursorPage> HistoryCursor(DateTime? beforeAt, Guid? beforeId, int size, CancellationToken ct)
    {
        Validation.Require(size is > 0 and <= 100, "Invalid page request.");
        var query = db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null);
        if (beforeAt is { } cursorAt && beforeId is { } cursorId)
            query = query.Where(w => w.FinishedAt < cursorAt || (w.FinishedAt == cursorAt && w.Id.CompareTo(cursorId) < 0));
        var rows = await query.OrderByDescending(w => w.FinishedAt).ThenByDescending(w => w.Id).Take(size + 1).ToListAsync(ct);
        var pageRows = rows.Take(size).ToList();
        var byId = await Views(pageRows, ct);
        var views = pageRows.Select(row => byId[row.Id]).ToList();
        var hasMore = rows.Count > size;
        var last = pageRows.LastOrDefault();
        return new HistoryCursorPage(views, hasMore && last is not null ? last.FinishedAt : null,
            hasMore && last is not null ? last.Id : null);
    }

    public async Task<List<WorkoutActivityItem>> Activity(DateOnly? from, DateOnly? to, string? timeZone, CancellationToken ct)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(timeZone), "A valid time zone is required.", 400);
        if (!TimeZoneInfo.TryFindSystemTimeZoneById(timeZone!.Trim(), out var zone))
            throw new DomainException("Unknown or unsupported time zone.", 400);

        var todayLocal = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        var start = from ?? todayLocal.AddDays(-30);
        var end = to ?? todayLocal;
        Validation.Require(start <= end && end.DayNumber - start.DayNumber <= 366, "Choose a date range of one year or less.");

        var startUtc = start.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(-1);
        var endUtc = end.AddDays(2).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var rows = await db.Workouts.AsNoTracking().Where(w =>
            (w.FinishedAt != null && w.FinishedAt >= startUtc && w.FinishedAt < endUtc) ||
            (w.Active && w.StartedAt >= startUtc && w.StartedAt < endUtc))
            .ToListAsync(ct);

        var items = new List<(WorkoutActivityItem Item, DateTime Timestamp)>();
        foreach (var w in rows)
        {
            var isCompleted = w.FinishedAt != null;
            var timestamp = isCompleted ? w.FinishedAt!.Value : w.StartedAt;
            var localDateTime = TimeZoneInfo.ConvertTimeFromUtc(timestamp, zone);
            var localDate = DateOnly.FromDateTime(localDateTime);
            if (localDate < start || localDate > end) continue;

            var status = isCompleted ? "completed" : "in_progress";
            items.Add((new WorkoutActivityItem(w.Id, w.Name, status, localDate), timestamp));
        }

        return items
            .OrderBy(x => x.Item.Date)
            .ThenBy(x => x.Timestamp)
            .Select(x => x.Item)
            .ToList();
    }

    public async Task<List<WorkoutTrainingSummary>> TrainingSummary(DateOnly? from, DateOnly? to, string? timeZone, CancellationToken ct)
    {
        var zone = string.IsNullOrWhiteSpace(timeZone) ? TimeZoneInfo.Utc : SafeZone(timeZone.Trim());
        var todayLocal = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        var start = from ?? todayLocal.AddDays(-30);
        var end = to ?? todayLocal;
        Validation.Require(start <= end && end.DayNumber - start.DayNumber <= 366, "Choose a date range of one year or less.");

        var startUtc = start.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(-1);
        var endUtc = end.AddDays(2).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        var rows = await db.Workouts.AsNoTracking().Where(w =>
            (w.FinishedAt != null && w.FinishedAt >= startUtc && w.FinishedAt < endUtc) ||
            (w.Active && w.StartedAt >= startUtc && w.StartedAt < endUtc))
            .OrderBy(w => w.StartedAt).ToListAsync(ct);

        var views = await Views(rows, ct);
        var muscleIds = views.Values.SelectMany(v => v.Exercises).Where(e => e.ExerciseId is not null)
            .Select(e => e.ExerciseId!.Value).Distinct().ToList();
        var musclesById = await catalog.MusclesFor(muscleIds, ct);
        var result = new List<WorkoutTrainingSummary>();

        foreach (var session in rows)
        {
            var localDateTime = TimeZoneInfo.ConvertTimeFromUtc(session.StartedAt, zone);
            var actualDate = DateOnly.FromDateTime(localDateTime);
            if (actualDate < start || actualDate > end) continue;

            var view = views[session.Id];
            var sets = view.Exercises.SelectMany(e => e.Sets).Where(s => s.Done && !s.Warmup).ToList();
            var rpes = sets.Where(s => s.Rpe is not null).Select(s => s.Rpe!.Value).ToList();
            var exerciseIds = view.Exercises.Where(e => e.ExerciseId is not null).Select(e => e.ExerciseId!.Value).Distinct().ToList();
            var muscles = exerciseIds.Select(id => musclesById.GetValueOrDefault(id, ""))
                .Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().OrderBy(x => x).ToList();
            var status = session.Active ? "in_progress" : "completed";
            result.Add(new WorkoutTrainingSummary($"session:{session.Id}", status, actualDate, session.StartedAt, session.FinishedAt,
                session.Name, muscles, sets.Count, view.VolumeKg, view.SystemVolumeKg, rpes.Count == 0 ? null : rpes.Average(), !session.Active, actualDate));
        }
        result.Sort((left, right) => left.LocalDate.CompareTo(right.LocalDate));
        return result;
    }

    private static double? ComputeSystemLoad(WorkoutSession session, string loadModel, string resistanceMode, double? input)
    {
        if (loadModel != LoadModels.FullBodyweight || string.IsNullOrWhiteSpace(session.BodyWeightSnapshotJson)) return null;
        var snapshot = Json.Read<BodyWeightSnapshot>(session.BodyWeightSnapshotJson);
        if (snapshot.ReferenceKg is not { } reference) return null;
        return resistanceMode switch
        {
            ResistanceModes.Bodyweight => reference,
            ResistanceModes.Added when input is { } added => reference + added,
            ResistanceModes.Assistance when input is { } assistance => Math.Max(0, reference - assistance),
            _ => null
        };
    }

    private static double? NormalizeEnteredLoad(string loadModel, string resistanceMode, double? input, double step)
        => loadModel == LoadModels.FullBodyweight && resistanceMode is (ResistanceModes.Added or ResistanceModes.Assistance) && input is { } value
            ? Progression.RoundToStep(Math.Max(0, value), step)
            : input;



    private static T? ReadOptional<T>(string json) where T : class
        => string.IsNullOrWhiteSpace(json) ? null : Json.Read<T>(json);
}

public record HistoryPage(int Total, int Page, int Size, List<SessionView> Sessions);
public record HistoryCursorPage(List<SessionView> Sessions, DateTime? NextBeforeAt, Guid? NextBeforeId);
