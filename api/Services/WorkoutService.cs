using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record SetInput(double? WeightKg, int? Reps, double? Rpe, bool Done, bool Warmup = false,
    string? ResistanceMode = null, Guid? Id = null);
public record SessionExerciseInput(Guid? ExerciseId, string NameSnapshot, string? Note, List<SetPrescription> Prescription, List<SetInput> Sets,
    string? SequenceGroup = null, List<string>? Substitutions = null, string? LoadModel = null, Guid? Id = null,
    Guid? SourceTemplateExerciseId = null, Guid? SourceSlotKey = null, Guid? SourcePhaseId = null, int? SourcePage = null);
public record SessionInput(string? Note, List<SessionExerciseInput> Exercises, int? Revision, Guid? IdempotencyId);
public record SetView(Guid Id, int Position, double? WeightKg, int? Reps, double? Rpe, bool Done, bool Warmup = false,
    int? WorkingSetOrdinal = null, string ResistanceMode = ResistanceModes.External, double? SystemLoadKg = null,
    SetProgressionSuggestion? Suggestion = null);
public record SessionExerciseView(Guid Id, Guid? ExerciseId, string Name, int Position, string Note, List<SetPrescription> Prescription, List<SetView> Sets,
    string SequenceGroup = "", List<string>? Substitutions = null, ProgressionView? Progression = null,
    string LoadModel = LoadModels.External, Guid? SourceTemplateExerciseId = null, Guid? SourceSlotKey = null, Guid? SourcePhaseId = null,
    Guid? SwapGroupKey = null, bool IsReplacement = false, Guid? OriginalExerciseId = null, string OriginalName = "", int? SourcePage = null,
    bool CanRestore = false);
public record SessionView(Guid Id, Guid? TemplateId, Guid? ProgramId, string Name, string Note, bool Active, DateTime StartedAt, DateTime? FinishedAt, int Revision,
    List<SessionExerciseView> Exercises, double? VolumeKg, int CompletedSets, int WarmupSets = 0,
    DateOnly? PlannedDate = null, BodyWeightSnapshot? BodyWeight = null, NutritionTrainingContext? NutritionContext = null,
    double? SystemVolumeKg = null);

public record SessionSubstitutionInput(Guid SessionExerciseId, Guid? ReplacementExerciseId, string ReplacementName,
    int? Revision, Guid? IdempotencyId);

public sealed partial class WorkoutService(
    AppDb db,
    CatalogService catalog,
    TemplateService templates,
    ProgressionService progression,
    NutritionContextService nutrition,
    ProgramService programs)
{
    // Keep the pre-phase constructor usable for integrations and focused tests that create the
    // service directly. The application container resolves the primary constructor above.
    public WorkoutService(AppDb db, CatalogService catalog, TemplateService templates,
        ProgressionService progression, NutritionContextService nutrition)
        : this(db, catalog, templates, progression, nutrition, new ProgramService(db, templates))
    {
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
        var exercises = await db.SessionExercises.AsNoTracking().Where(e => e.SessionId == session.Id).OrderBy(e => e.Position).ToListAsync(ct);
        var ids = exercises.Select(e => e.Id).ToList();
        var sets = await db.Sets.AsNoTracking().Where(s => ids.Contains(s.SessionExerciseId)).OrderBy(s => s.Position).ToListAsync(ct);
        var done = sets.Where(s => s.Done).ToList();
        var workingDone = done.Where(s => !s.Warmup).ToList();
        var warmupDone = done.Where(s => s.Warmup).ToList();
        var loadModels = exercises.ToDictionary(e => e.Id, e => e.LoadModel);
        var external = workingDone.Where(s => s.WeightKg != null && s.SystemLoadKg == null &&
            loadModels.GetValueOrDefault(s.SessionExerciseId, LoadModels.External) == LoadModels.External).ToList();
        var system = workingDone.Where(s => s.SystemLoadKg != null).ToList();
        var bodyWeight = ReadOptional<BodyWeightSnapshot>(session.BodyWeightSnapshotJson);
        var context = ReadOptional<NutritionTrainingContext>(session.NutritionContextJson);
        return new SessionView(session.Id, session.TemplateId, session.ProgramId, session.Name, session.Note, session.Active,
            session.StartedAt, session.FinishedAt, session.Revision,
            exercises.Select(e =>
            {
                var exerciseSets = sets.Where(s => s.SessionExerciseId == e.Id).ToList();
                var canRestore = e.IsReplacement && !string.IsNullOrEmpty(e.BaselineJson) && !exerciseSets.Any(s => s.Done);
                return new SessionExerciseView(e.Id, e.ExerciseId, e.NameSnapshot, e.Position, e.Note,
                    Json.Read<List<SetPrescription>>(e.PrescriptionJson),
                    exerciseSets.Select(s => new SetView(s.Id, s.Position, s.WeightKg, s.Reps, s.Rpe, s.Done, s.Warmup,
                        s.WorkingSetOrdinal, s.ResistanceMode, s.SystemLoadKg, ReadOptional<SetProgressionSuggestion>(s.SuggestionJson))).ToList(),
                    e.SequenceGroup, Json.Read<List<string>>(e.SubstitutionsJson),
                    ReadOptional<ProgressionView>(e.ProgressionJson), e.LoadModel, e.SourceTemplateExerciseId, e.SourceSlotKey, e.SourcePhaseId,
                    e.SwapGroupKey, e.IsReplacement, e.OriginalExerciseId, e.OriginalNameSnapshot, e.SourcePage, canRestore);
            }).ToList(),
            external.Count == 0 ? null : external.Sum(s => s.WeightKg!.Value * s.Reps!.Value),
            workingDone.Count, warmupDone.Count, session.PlannedDate, bodyWeight, context,
            system.Count == 0 ? null : system.Sum(s => s.SystemLoadKg!.Value * s.Reps!.Value));
    }

    /// Start-time snapshots are the contract: all set suggestions and Nutrition context are made
    /// once here, then saved on the session so later settings/history changes cannot rewrite them.
    public async Task<SessionView> Start(Guid? templateId, string? name, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        Validation.Require(!await db.Workouts.AnyAsync(w => w.Active, ct), "Finish or discard your current workout before starting another.", 409);
        WorkoutTemplate? template = null;
        if (templateId is { } id)
        {
            template = await db.Templates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, ct);
            Validation.Require(template != null, "That workout plan no longer exists.", 404);
            Validation.Require(!template!.IsRestDay, "That slot is a rest day.", 409);
            if (template.ProgramId is { } programId)
            {
                // A rest-only phase can finish by elapsed calendar time without a workout
                // request. Reconcile before choosing the next slot so its following phase gets
                // the correct (possibly shifted) Monday start and a stale completed program
                // cannot be started again.
                await programs.Reconcile(programId, ct);
                await db.SaveChangesAsync(ct);
                var program = await db.Programs.AsNoTracking().SingleAsync(p => p.Id == programId, ct);
                Validation.Require(program.Active && program.LifecycleStatus != ProgramLifecycle.Completed, "Activate this program before starting its workouts.", 409);
                var completed = await db.Workouts.AsNoTracking().Where(w => w.ProgramId == programId && w.FinishedAt != null && w.TemplateId != null)
                    .Select(w => w.TemplateId!.Value).Distinct().ToListAsync(ct);
                var skipped = await db.ProgramSkips.AsNoTracking().Where(s => s.ProgramId == programId).Select(s => s.TemplateId).ToListAsync(ct);
                var programTemplates = await db.Templates.AsNoTracking().Where(t => t.ProgramId == programId)
                    .OrderBy(t => t.Week).ThenBy(t => t.Position).ToListAsync(ct);
                var nextId = programTemplates.Where(t => !t.IsRestDay && !completed.Contains(t.Id) && !skipped.Contains(t.Id))
                    .Select(t => (Guid?)t.Id).FirstOrDefault();
                Validation.Require(nextId == template.Id, "Finish or skip the earlier workout slots first.", 409);
                var phases = await db.ProgramPhases.AsNoTracking().Where(p => p.ProgramId == programId).OrderBy(p => p.Position).ToListAsync(ct);
                var phase = phases.FirstOrDefault(candidate => template.Week >= candidate.WeekFrom && template.Week <= candidate.WeekTo && BelongsToPhase(template, candidate));
                if (phase is not null)
                {
                    var today = LocalToday(program.TimeZone);
                    var completedIds = completed.ToHashSet(); var skippedIds = skipped.ToHashSet();
                    foreach (var previous in phases.Where(candidate => candidate.Position < phase.Position))
                    {
                        Validation.Require(IsPhaseComplete(previous, programTemplates, completedIds, skippedIds, today),
                            "Finish or skip the earlier phase slots first.", 409);
                    }
                    if (phase.Position > 0 && phase.StartDate is { } startDate)
                        Validation.Require(today >= startDate, $"The next phase begins on {startDate:yyyy-MM-dd}.", 409);
                }
            }
        }
        else Validation.Name(name, "Workout name");

        var contextResult = await nutrition.Get(ct);
        var context = contextResult.Context;
        var bodyWeight = ChooseBodyWeight(context);
        var session = new WorkoutSession
        {
            UserId = db.CurrentUser!.Value,
            TemplateId = template?.Id,
            ProgramId = template?.ProgramId,
            Name = template?.Name ?? name!.Trim(),
            Active = true,
            PlannedDate = template is null ? null : await PlannedDate(template, ct),
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
            foreach (var plan in planned)
            {
                var prescription = Json.Read<List<SetPrescription>>(plan.SetsJson);
                var resolvedName = plan.ExerciseId is { } catalogId && names.TryGetValue(catalogId, out var resolved) ? resolved : plan.SourceName;
                var loadModel = plan.ExerciseId is { } modelId && info.TryGetValue(modelId, out _) ?
                    (await catalog.LoadModelsFor([modelId], ct)).GetValueOrDefault(modelId, LoadModels.External) : LoadModels.External;
                var exercise = new SessionExercise
                {
                    UserId = session.UserId, SessionId = session.Id, ExerciseId = plan.ExerciseId, Position = plan.Position,
                    NameSnapshot = resolvedName, Note = plan.Note, PrescriptionJson = Json.Write(prescription), SequenceGroup = plan.SequenceGroup,
                    SubstitutionsJson = plan.SubstitutionsJson, LoadModel = loadModel,
                    SourceTemplateExerciseId = plan.Id, SourceSlotKey = plan.SlotKey, SourcePhaseId = template.ProgramPhaseId, SourcePage = plan.SourcePage
                };
                db.SessionExercises.Add(exercise);

                var histories = await PreviousExposures(plan.ExerciseId, plan.SourceName, ct);
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
                    var exposures = histories.GetValueOrDefault(workingOrdinal) ?? [];
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

    private async Task<DateOnly?> PlannedDate(WorkoutTemplate template, CancellationToken ct)
    {
        if (template.ProgramId is not { } programId || template.Weekday is not { } weekday) return null;
        var schedule = await db.Programs.AsNoTracking().Where(p => p.Id == programId).Select(p => new { p.ScheduleAnchor, p.TimeZone }).SingleOrDefaultAsync(ct);
        if (schedule?.ScheduleAnchor is not { } anchor) return null;
        var phaseRows = await db.ProgramPhases.AsNoTracking().Where(p => p.ProgramId == programId && template.Week >= p.WeekFrom && template.Week <= p.WeekTo)
            .OrderBy(p => p.Position).ToListAsync(ct);
        var phase = phaseRows.FirstOrDefault(candidate => BelongsToPhase(template, candidate));
        var start = phase?.StartDate ?? anchor.AddDays(((phase?.WeekFrom ?? 1) - 1) * 7);
        return start.AddDays((template.Week - (phase?.WeekFrom ?? 1)) * 7 + weekday - 1);
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

    private static DateOnly LocalToday(string timeZone)
    {
        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
            return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        }
        catch { return DateOnly.FromDateTime(DateTime.UtcNow); }
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
        IReadOnlySet<Guid> completed, IReadOnlySet<Guid> skipped, DateOnly today)
    {
        var ids = rows.Where(template => !template.IsRestDay && template.Week >= phase.WeekFrom && template.Week <= phase.WeekTo && BelongsToPhase(template, phase)).Select(template => template.Id).ToList();
        if (ids.Count > 0) return ids.All(id => completed.Contains(id) || skipped.Contains(id));
        return phase.StartDate is { } start && today >= start.AddDays(phase.DurationWeeks * 7 - 1);
    }

    /// Return the latest three completed exposures plus the most recent successful exposure per
    /// working-set ordinal, matching catalog id or normalized unresolved name. Warm-ups are
    /// excluded before legacy ordinals are assigned.
    public async Task<Dictionary<int, List<SetExposure>>> PreviousExposures(Guid? exerciseId, string name, CancellationToken ct)
    {
        var query = db.SessionExercises.AsNoTracking().Join(db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null),
            e => e.SessionId, w => w.Id, (e, w) => new { Exercise = e, w.Id, w.FinishedAt });
        var matches = exerciseId is { } id
            ? await query.Where(x => x.Exercise.ExerciseId == id).OrderByDescending(x => x.FinishedAt).Take(30).ToListAsync(ct)
            : (await query.Where(x => x.Exercise.ExerciseId == null).OrderByDescending(x => x.FinishedAt).Take(60).ToListAsync(ct))
                .Where(x => CatalogService.Normalize(x.Exercise.NameSnapshot) == CatalogService.Normalize(name)).Take(30).ToList();
        var exerciseIds = matches.Select(x => x.Exercise.Id).ToList();
        if (exerciseIds.Count == 0) return [];
        var sets = await db.Sets.AsNoTracking().Where(s => exerciseIds.Contains(s.SessionExerciseId) && s.Done && !s.Warmup)
            .OrderBy(s => s.Position).ToListAsync(ct);
        var output = new Dictionary<int, List<SetExposure>>();
        foreach (var match in matches.OrderByDescending(x => x.FinishedAt))
        {
            var legacyOrdinal = 0;
            foreach (var set in sets.Where(s => s.SessionExerciseId == match.Exercise.Id).OrderBy(s => s.Position))
            {
                var ordinal = set.WorkingSetOrdinal ?? ++legacyOrdinal;
                if (set.WorkingSetOrdinal is not null) legacyOrdinal = Math.Max(legacyOrdinal, ordinal);
                var list = output.GetValueOrDefault(ordinal);
                if (list is null) { list = []; output[ordinal] = list; }
                // Four rows are enough for a three-hard-exposure decision and the successful
                // exposure immediately before that streak. The policy reads newest first.
                if (list.Count >= 4) continue;
                list.Add(new SetExposure(match.Id, match.FinishedAt!.Value, set.WeightKg, set.Reps, set.Rpe, set.SystemLoadKg, set.ResistanceMode));
            }
        }
        return output;
    }

    /// Compatibility helper used by exports and older callers: the newest completed working sets
    /// are returned in ordinal order.
    public async Task<List<CompletedSet>> Previous(Guid? exerciseId, string name, CancellationToken ct)
    {
        var histories = await PreviousExposures(exerciseId, name, ct);
        return histories.OrderBy(pair => pair.Key).SelectMany(pair => pair.Value.Take(1).Select(exposure => new CompletedSet
        {
            WeightKg = exposure.LoadKg, Reps = exposure.Reps, Rpe = exposure.Rpe, SystemLoadKg = exposure.SystemLoadKg,
            ResistanceMode = exposure.ResistanceMode, Done = true, Warmup = false, WorkingSetOrdinal = pair.Key
        })).ToList();
    }

    public async Task<SessionView> Save(Guid id, SessionInput input, CancellationToken ct)
    {
        Validation.Text(input.Note, 4000, "Workout notes");
        Validation.Require(input.Exercises is { Count: <= 40 }, "A workout can have at most 40 exercises.");
        foreach (var exercise in input.Exercises)
        {
            Validation.Name(exercise.NameSnapshot, "Exercise name", 160);
            Validation.Text(exercise.Note, 1000, "Exercise notes");
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

        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        var sessionRow = session!;
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
        await templates.Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    /// Swap an exercise in the running session while preserving the source slot and all completed
    /// history. When the exercise is partially complete the unfinished sets move to a second row;
    /// the UI can therefore render one logical slot with an original and a continuation.
    public async Task<SessionView> Swap(Guid id, SessionSubstitutionInput input, CancellationToken ct)
    {
        Validation.Name(input.ReplacementName, "Replacement exercise", 160);
        await catalog.RequireActive(input.ReplacementExerciseId, ct);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        var swapSession = session!;
        Validation.Require(swapSession.Active, "This workout is already saved to your history.", 409);
        TemplateService.RequireFresh(input.Revision, swapSession.Revision);
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
        await templates.Receipt(input.IdempotencyId, ct);
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
    public async Task<SessionView> Finish(Guid id, int? revision, CancellationToken ct, bool retainExerciseSwaps = false)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);
        Validation.Require(session!.Active, "This workout is already saved to your history.", 409);
        TemplateService.RequireFresh(revision, session.Revision);
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

        session.Active = false; session.FinishedAt = DateTime.UtcNow; session.Revision++;
        await db.SaveChangesAsync(ct);
        if (session.ProgramId is { } programId) await programs.Reconcile(programId, ct);
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
        await Remove(session, ct); await db.SaveChangesAsync(ct); await gate.Commit(ct);
    }

    public async Task DeleteFromHistory(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id && !w.Active, ct);
        Validation.Require(session != null, "That workout is not in your history.", 404);
        var programId = session!.ProgramId;
        await Remove(session, ct);
        await db.SaveChangesAsync(ct);
        if (programId is { } restoredProgram) await programs.Reconcile(restoredProgram, ct);
        await db.SaveChangesAsync(ct); await gate.Commit(ct);
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
        var views = new List<SessionView>();
        foreach (var row in rows) views.Add(await View(row, ct));
        return new HistoryPage(total, page, size, views);
    }

    public async Task<List<WorkoutTrainingSummary>> TrainingSummary(DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var start = from ?? DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-30);
        var end = to ?? DateOnly.FromDateTime(DateTime.UtcNow);
        Validation.Require(start <= end && end.DayNumber - start.DayNumber <= 366, "Choose a date range of one year or less.");
        var startUtc = start.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var endUtc = end.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var rows = await db.Workouts.AsNoTracking().Where(w =>
            (w.PlannedDate >= start && w.PlannedDate <= end) ||
            (w.PlannedDate == null &&
                ((w.FinishedAt != null && w.FinishedAt >= startUtc && w.FinishedAt < endUtc) ||
                 (w.Active && w.StartedAt >= startUtc && w.StartedAt < endUtc))))
            .OrderBy(w => w.PlannedDate).ThenBy(w => w.StartedAt).ToListAsync(ct);
        var result = new List<WorkoutTrainingSummary>();
        var occupiedScheduledSlots = rows.Where(row => row.TemplateId is not null && row.PlannedDate is not null)
            .Select(row => (TemplateId: row.TemplateId!.Value, Date: row.PlannedDate!.Value)).ToHashSet();
        foreach (var session in rows)
        {
            var view = await View(session, ct);
            var sets = view.Exercises.SelectMany(e => e.Sets).Where(s => s.Done && !s.Warmup).ToList();
            var rpes = sets.Where(s => s.Rpe is not null).Select(s => s.Rpe!.Value).ToList();
            var exerciseIds = view.Exercises.Where(e => e.ExerciseId is not null).Select(e => e.ExerciseId!.Value).Distinct().ToList();
            var muscles = (await catalog.MusclesFor(exerciseIds, ct)).Values.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().OrderBy(x => x).ToList();
            var actualDate = DateOnly.FromDateTime(session.StartedAt);
            var status = session.Active ? "in_progress" : session.PlannedDate is { } planned && actualDate < planned ? "completed_early" :
                session.PlannedDate is { } later && actualDate > later ? "completed_late" : "completed";
            result.Add(new WorkoutTrainingSummary($"session:{session.Id}", status, session.PlannedDate ?? actualDate, session.StartedAt, session.FinishedAt,
                session.Name, muscles, sets.Count, view.VolumeKg, view.SystemVolumeKg, rpes.Count == 0 ? null : rpes.Average(), !session.Active, actualDate));
        }
        var scheduled = await db.Templates.AsNoTracking().Join(db.Programs.AsNoTracking(), t => t.ProgramId, p => p.Id,
            (t, p) => new { Template = t, p.Id, p.ScheduleAnchor, p.Active }).Where(x => x.Active && x.ScheduleAnchor != null && x.Template.Weekday != null && !x.Template.IsRestDay).ToListAsync(ct);
        var scheduledProgramIds = scheduled.Select(item => item.Id).Distinct().ToList();
        var skippedScheduled = await db.ProgramSkips.AsNoTracking().Where(skip => scheduledProgramIds.Contains(skip.ProgramId))
            .Select(skip => skip.TemplateId).ToHashSetAsync(ct);
        var phaseSchedules = await db.ProgramPhases.AsNoTracking().Where(phase => scheduledProgramIds.Contains(phase.ProgramId))
            .OrderBy(phase => phase.Position).ToListAsync(ct);
        foreach (var item in scheduled)
        {
            var isSkipped = skippedScheduled.Contains(item.Template.Id);
            var phases = phaseSchedules.Where(phase => phase.ProgramId == item.Id);
            var phase = phases.FirstOrDefault(candidate => item.Template.Week >= candidate.WeekFrom && item.Template.Week <= candidate.WeekTo &&
                BelongsToPhase(item.Template, candidate));
            var phaseFrom = phase?.WeekFrom ?? 1;
            var phaseStart = phase?.StartDate ?? item.ScheduleAnchor!.Value.AddDays((phaseFrom - 1) * 7);
            var date = phaseStart.AddDays((item.Template.Week - phaseFrom) * 7 + item.Template.Weekday!.Value - 1);
            // A session finished early or late does not move the template's future planned slot.
            // Only the exact scheduled date is replaced by its completed summary.
            if (date < start || date > end || occupiedScheduledSlots.Contains((item.Template.Id, date))) continue;
            var exerciseIds = await db.TemplateExercises.AsNoTracking().Where(e => e.TemplateId == item.Template.Id && e.ExerciseId != null)
                .Select(e => e.ExerciseId!.Value).Distinct().ToListAsync(ct);
            var muscles = (await catalog.MusclesFor(exerciseIds, ct)).Values.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().OrderBy(x => x).ToList();
            var status = isSkipped ? "skipped" : date < DateOnly.FromDateTime(DateTime.UtcNow) ? "missed" : "scheduled";
            result.Add(new WorkoutTrainingSummary($"schedule:{item.Template.Id}:{date:yyyy-MM-dd}", status, date, null, null, item.Template.Name, muscles, 0, null, null, null, false));
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
