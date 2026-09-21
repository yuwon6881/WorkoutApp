using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record ProgramWorkoutInput(int Week, string Name, string? Focus, string? Note, List<TemplateExerciseInput> Exercises,
    string? Block = null, string? Phase = null, int PhaseWeek = 1, bool IsRestDay = false, int? SourcePage = null);
public record ProgramInput(string Name, List<ProgramWorkoutInput> Workouts, Guid? IdempotencyId = null);
public record ProgramPhaseView(Guid Id, string Name, string Block, int WeekFrom, int WeekTo, int DurationWeeks,
    int CompletedWorkouts, int TotalWorkouts, bool Complete, int CurrentWeek = 1, int SkippedWorkouts = 0,
    int? SourcePageFrom = null, int? SourcePageTo = null);
public record ProgramView(Guid Id, string Name, int Weeks, bool Active, int Revision, Guid? SourceImportId, List<TemplateView> Workouts, List<Guid> CompletedTemplateIds, Guid? NextTemplateId,
    string LifecycleStatus = ProgramLifecycle.Standby, DateTime? CompletedAt = null, List<Guid>? SkippedTemplateIds = null,
    List<ProgramPhaseView>? Phases = null, ProgramProgressView? Progress = null);
public record ProgramDayView(Guid Id, string Name, string Focus, string Block, string Phase, int Week, int PhaseWeek, int Position, bool IsRestDay, int ExerciseCount,
    int? SourcePage = null, string? ProgressStatus = null);
public record ProgramProgressDayView(Guid TemplateId, string Status, bool IsRestDay, int Position);
public record ProgramProgressView(Guid RunId, int CurrentWeek, int CurrentAttempt, int PassedDays, int TotalDays, List<ProgramProgressDayView> Days);
public record ProgramSummaryView(Guid Id, string Name, int Weeks, bool Active, int Revision, Guid? SourceImportId,
    List<ProgramDayView> Days, List<Guid> CompletedTemplateIds, Guid? NextTemplateId,
    string LifecycleStatus = ProgramLifecycle.Standby, DateTime? CompletedAt = null, List<Guid>? SkippedTemplateIds = null,
    List<ProgramPhaseView>? Phases = null, ProgramProgressView? Progress = null);
public record ProgramDayActionInput(int? Revision, Guid? RunId, int? Week, int? Attempt, Guid? IdempotencyId = null);
public record ProgramWeekResetInput(int? Revision, Guid? RunId, int? Week, int? Attempt, string Confirmation, Guid? IdempotencyId = null);

public sealed class ProgramService(AppDb db, TemplateService templates, ProgramProgressService progress, ProgramLifecycleService lifecycle)
{
    public async Task<List<ProgramSummaryView>> List(CancellationToken ct)
    {
        var programs = await db.Programs.AsNoTracking().OrderByDescending(p => p.Active).ThenByDescending(p => p.Created).ToListAsync(ct);
        if (programs.Count == 0) return [];

        // Older active programs have no run rows yet. Repair that single slot under the account
        // lock, then build the bootstrap view from persisted run state.
        foreach (var active in programs.Where(program => program.Active)) await lifecycle.EnsureActiveRun(active.Id, ct);
        programs = await db.Programs.AsNoTracking().OrderByDescending(p => p.Active).ThenByDescending(p => p.Created).ToListAsync(ct);

        // The bootstrap used to call Summary once per program, which in turn loaded templates,
        // counts, completion, skips, and phases independently. These bounded set queries keep
        // the request cost stable as a user accumulates programs.
        var ids = programs.Select(p => p.Id).ToList();
        var templates = await db.Templates.AsNoTracking().Where(t => t.ProgramId != null && ids.Contains(t.ProgramId.Value))
            .OrderBy(t => t.ProgramId).ThenBy(t => t.Week).ThenBy(t => t.Position).ToListAsync(ct);
        var templateIds = templates.Select(t => t.Id).ToList();
        var exerciseCounts = templateIds.Count == 0 ? new Dictionary<Guid, int>() : await db.TemplateExercises.AsNoTracking()
            .Where(e => templateIds.Contains(e.TemplateId)).GroupBy(e => e.TemplateId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var phases = await db.ProgramPhases.AsNoTracking().Where(p => ids.Contains(p.ProgramId)).OrderBy(p => p.Position).ToListAsync(ct);
        var runs = await db.ProgramRuns.AsNoTracking().Where(run => ids.Contains(run.ProgramId)).OrderBy(run => run.Number).ToListAsync(ct);
        var runIds = runs.Select(run => run.Id).ToList();
        var dayProgress = runIds.Count == 0 ? [] : await db.ProgramDayProgresses.AsNoTracking()
            .Where(day => runIds.Contains(day.RunId)).ToListAsync(ct);
        var views = new List<ProgramSummaryView>(programs.Count);
        foreach (var program in programs)
        {
            var rows = templates.Where(t => t.ProgramId == program.Id).ToList();
            var programPhases = phases.Where(p => p.ProgramId == program.Id).ToList();
            // Legacy programs without persisted phases retain the existing repair path. New and
            // migrated programs use the batched read model above.
            if (programPhases.Count == 0 && rows.Count > 0)
            {
                views.Add(await Summary(program, ct));
                continue;
            }
            var run = runs.LastOrDefault(candidate => candidate.ProgramId == program.Id);
            var relevantProgress = RelevantProgress(run, dayProgress.Where(day => day.RunId == run?.Id).ToList());
            var statusByTemplate = relevantProgress.ToDictionary(day => day.TemplateId, day => day.Status);
            var completed = relevantProgress.Where(day => day.Status == ProgramDayStatus.Completed).Select(day => day.TemplateId).ToList();
            var skipped = relevantProgress.Where(day => day.Status == ProgramDayStatus.Skipped).Select(day => day.TemplateId).ToList();
            var days = rows.Select(t => new ProgramDayView(t.Id, t.Name, t.Focus, t.Block, t.Phase, t.Week, t.PhaseWeek,
                t.Position, t.IsRestDay, exerciseCounts.GetValueOrDefault(t.Id), t.SourcePage, statusByTemplate.GetValueOrDefault(t.Id))).ToList();
            var next = run is null || run.CompletedAt is not null ? null : days.FirstOrDefault(day => day.Week == run.CurrentWeek &&
                !day.IsRestDay && day.ProgressStatus == ProgramDayStatus.Pending)?.Id;
            var phaseViews = BuildPhaseViews(programPhases, rows, completed, skipped);
            views.Add(new ProgramSummaryView(program.Id, program.Name, program.Weeks, program.Active, program.Revision, program.SourceImportId,
                days, completed, next, program.LifecycleStatus, program.CompletedAt, skipped, phaseViews,
                CreateProgressView(run, rows, relevantProgress)));
        }
        return views;
    }

    public async Task<List<ProgramView>> FullList(CancellationToken ct)
    {
        var programs = await db.Programs.AsNoTracking().OrderByDescending(p => p.Active).ThenByDescending(p => p.Created).ToListAsync(ct);
        var views = new List<ProgramView>();
        foreach (var program in programs) views.Add(await View(program, ct));
        return views;
    }

    public async Task<ProgramView> Get(Guid id, CancellationToken ct)
    {
        var program = await db.Programs.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        Validation.Require(program != null, "That program no longer exists.", 404);
        return await View(program!, ct);
    }

    public async Task<ProgramView> View(TrainingProgram program, CancellationToken ct)
    {
        var rows = await db.Templates.AsNoTracking().Where(t => t.ProgramId == program.Id).OrderBy(t => t.Week).ThenBy(t => t.Position).ToListAsync(ct);
        var workouts = await templates.Views(rows, ct);
        var run = await db.ProgramRuns.AsNoTracking().Where(candidate => candidate.ProgramId == program.Id)
            .OrderByDescending(candidate => candidate.Number).FirstOrDefaultAsync(ct);
        var runProgress = run is null ? [] : await db.ProgramDayProgresses.AsNoTracking().Where(day => day.RunId == run.Id).ToListAsync(ct);
        var relevantProgress = RelevantProgress(run, runProgress);
        var statusByTemplate = relevantProgress.ToDictionary(day => day.TemplateId, day => day.Status);
        var completed = relevantProgress.Where(day => day.Status == ProgramDayStatus.Completed).Select(day => day.TemplateId).ToList();
        var skipped = relevantProgress.Where(day => day.Status == ProgramDayStatus.Skipped).Select(day => day.TemplateId).ToList();
        var next = run is null || run.CompletedAt is not null ? null : workouts.FirstOrDefault(workout =>
            workout.Week == run.CurrentWeek && !workout.IsRestDay && statusByTemplate.GetValueOrDefault(workout.Id) == ProgramDayStatus.Pending)?.Id;
        var phases = await PhaseViews(program.Id, rows, completed, skipped, ct);
        return new ProgramView(program.Id, program.Name, program.Weeks, program.Active, program.Revision, program.SourceImportId, workouts, completed, next,
            program.LifecycleStatus, program.CompletedAt, skipped, phases, CreateProgressView(run, rows, relevantProgress));
    }

    public async Task<ProgramSummaryView> Summary(TrainingProgram program, CancellationToken ct)
    {
        var rows = await db.Templates.AsNoTracking().Where(t => t.ProgramId == program.Id)
            .OrderBy(t => t.Week).ThenBy(t => t.Position).ToListAsync(ct);
        var ids = rows.Select(t => t.Id).ToList();
        var exerciseCounts = await db.TemplateExercises.AsNoTracking().Where(e => ids.Contains(e.TemplateId))
            .GroupBy(e => e.TemplateId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var run = await db.ProgramRuns.AsNoTracking().Where(candidate => candidate.ProgramId == program.Id)
            .OrderByDescending(candidate => candidate.Number).FirstOrDefaultAsync(ct);
        var runProgress = run is null ? [] : await db.ProgramDayProgresses.AsNoTracking().Where(day => day.RunId == run.Id).ToListAsync(ct);
        var relevantProgress = RelevantProgress(run, runProgress);
        var statusByTemplate = relevantProgress.ToDictionary(day => day.TemplateId, day => day.Status);
        var completed = relevantProgress.Where(day => day.Status == ProgramDayStatus.Completed).Select(day => day.TemplateId).ToList();
        var skipped = relevantProgress.Where(day => day.Status == ProgramDayStatus.Skipped).Select(day => day.TemplateId).ToList();
        var days = rows.Select(t => new ProgramDayView(t.Id, t.Name, t.Focus, t.Block, t.Phase, t.Week, t.PhaseWeek, t.Position,
            t.IsRestDay, exerciseCounts.GetValueOrDefault(t.Id), t.SourcePage, statusByTemplate.GetValueOrDefault(t.Id))).ToList();
        var next = run is null || run.CompletedAt is not null ? null : days.FirstOrDefault(day => day.Week == run.CurrentWeek &&
            !day.IsRestDay && day.ProgressStatus == ProgramDayStatus.Pending)?.Id;
        var phases = await PhaseViews(program.Id, rows, completed, skipped, ct);
        return new ProgramSummaryView(program.Id, program.Name, program.Weeks, program.Active, program.Revision,
            program.SourceImportId, days, completed, next, program.LifecycleStatus, program.CompletedAt, skipped, phases,
            CreateProgressView(run, rows, relevantProgress));
    }

    public async Task<ProgramView> Create(ProgramInput input, bool activate, Guid? sourceImportId, CancellationToken ct)
    {
        await Validate(input, ct, sourceImportId != null);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await Materialize(input, activate, sourceImportId, ct);
        await templates.Receipt(input.IdempotencyId, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(program.Id, ct);
    }

    /// Builds the program and all of its workouts in one unit of work. The caller owns the
    /// transaction so an AI acceptance either lands whole or not at all.
    public async Task<TrainingProgram> Materialize(ProgramInput input, bool activate, Guid? sourceImportId, CancellationToken ct)
    {
        // A new program only becomes active when nothing else holds that slot.
        var active = activate && !await db.Programs.AnyAsync(p => p.Active, ct);
        var program = new TrainingProgram
        {
            UserId = db.CurrentUser!.Value, Name = input.Name.Trim(),
            Weeks = input.Workouts.Max(w => w.Week), Active = active, LifecycleStatus = active ? ProgramLifecycle.Active : ProgramLifecycle.Standby,
            SourceImportId = sourceImportId
        };
        db.Programs.Add(program);
        var position = new Dictionary<int, int>();
        foreach (var workout in input.Workouts)
        {
            position.TryGetValue(workout.Week, out var index);
            position[workout.Week] = index + 1;
            var template = new WorkoutTemplate
            {
                UserId = program.UserId, ProgramId = program.Id, Name = workout.Name.Trim(), Focus = workout.Focus?.Trim() ?? "",
                Note = workout.Note?.Trim() ?? "", Week = workout.Week, Position = index,
                Block = workout.Block?.Trim() ?? "", Phase = workout.Phase?.Trim() ?? "", PhaseWeek = workout.PhaseWeek,
                IsRestDay = workout.IsRestDay, SourcePage = workout.SourcePage
            };
            db.Templates.Add(template);
            templates.AddExercises(template.Id, workout.Exercises);
            template.BaselineJson = TemplateService.CreateTemplateBaseline(template, db.TemplateExercises.Local.Where(e => e.TemplateId == template.Id));
        }
        var phases = CreatePhases(program, input.Workouts);
        var templatesForPhase = db.Templates.Local.Where(t => t.ProgramId == program.Id).ToList();
        for (var phaseIndex = 0; phaseIndex < phases.Count; phaseIndex++)
        {
            var group = GroupPhases(input.Workouts)[phaseIndex];
            var from = group.Min(w => w.Week); var to = group.Max(w => w.Week);
            foreach (var template in templatesForPhase.Where(t => t.Week >= from && t.Week <= to &&
                string.Equals(t.Block, group[0].Block?.Trim() ?? "", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(t.Phase, group[0].Phase?.Trim() ?? "", StringComparison.OrdinalIgnoreCase)))
                template.ProgramPhaseId = phases[phaseIndex].Id;
        }
        if (active) progress.CreateRun(program, templatesForPhase, number: 1);
        return program;
    }

    private List<ProgramPhase> CreatePhases(TrainingProgram program, IEnumerable<ProgramWorkoutInput> workouts)
    {
        var groups = GroupPhases(workouts);
        var position = 0;
        var result = new List<ProgramPhase>();
        foreach (var group in groups)
        {
            var from = group.Min(w => w.Week); var to = group.Max(w => w.Week);
            var block = group[0].Block?.Trim() ?? ""; var phase = group[0].Phase?.Trim() ?? "";
            var phaseRow = new ProgramPhase { UserId = program.UserId, ProgramId = program.Id, Position = position++,
                Name = string.IsNullOrWhiteSpace(phase) ? (string.IsNullOrWhiteSpace(block) ? "Program" : block) : phase,
                Block = block, WeekFrom = from, WeekTo = to, DurationWeeks = to - from + 1,
                SourcePageFrom = group.Select(w => w.SourcePage).Where(p => p is > 0).Min(),
                SourcePageTo = group.Select(w => w.SourcePage).Where(p => p is > 0).Max() };
            db.ProgramPhases.Add(phaseRow); result.Add(phaseRow);
        }
        return result;
    }

    private static List<List<ProgramWorkoutInput>> GroupPhases(IEnumerable<ProgramWorkoutInput> workouts)
    {
        var ordered = workouts.Select((workout, index) => (workout, index))
            .OrderBy(item => item.workout.Week).ThenBy(item => item.index).Select(item => item.workout).ToList();
        var groups = new List<List<ProgramWorkoutInput>>();
        foreach (var workout in ordered)
        {
            var previous = groups.Count == 0 ? null : groups[^1][^1];
            var startsNew = previous is not null &&
                (!SamePhase(previous, workout) ||
                 (previous.PhaseWeek > 1 && workout.Week > previous.Week && workout.PhaseWeek <= previous.PhaseWeek));
            if (startsNew || groups.Count == 0) groups.Add([]);
            groups[^1].Add(workout);
        }
        return groups;
    }

    private static bool SamePhase(ProgramWorkoutInput left, ProgramWorkoutInput right)
        => string.Equals(left.Block?.Trim() ?? "", right.Block?.Trim() ?? "", StringComparison.OrdinalIgnoreCase) &&
           string.Equals(left.Phase?.Trim() ?? "", right.Phase?.Trim() ?? "", StringComparison.OrdinalIgnoreCase);

    private static List<List<WorkoutTemplate>> GroupTemplatePhases(IEnumerable<WorkoutTemplate> templates)
    {
        var ordered = templates.OrderBy(template => template.Week).ThenBy(template => template.Position).ToList();
        var groups = new List<List<WorkoutTemplate>>();
        foreach (var template in ordered)
        {
            var previous = groups.Count == 0 ? null : groups[^1][^1];
            var startsNew = previous is not null &&
                (!string.Equals(previous.Block.Trim(), template.Block.Trim(), StringComparison.OrdinalIgnoreCase) ||
                 !string.Equals(previous.Phase.Trim(), template.Phase.Trim(), StringComparison.OrdinalIgnoreCase) ||
                 (previous.PhaseWeek > 1 && template.Week > previous.Week && template.PhaseWeek <= previous.PhaseWeek));
            if (startsNew || groups.Count == 0) groups.Add([]);
            groups[^1].Add(template);
        }
        return groups;
    }

    public async Task<ProgramView> SetActive(Guid id, bool active, int? revision, CancellationToken ct)
    {
        await lifecycle.SetActive(id, active, revision, ct);
        return await Get(id, ct);
    }

    public async Task<ProgramView> Skip(Guid id, Guid templateId, ProgramDayActionInput input, CancellationToken ct)
    {
        await lifecycle.Skip(id, templateId, input, ct);
        return await Get(id, ct);
    }

    public async Task<ProgramView> Skip(Guid id, Guid templateId, CancellationToken ct)
    {
        await lifecycle.SkipLegacy(id, templateId, ct);
        return await Get(id, ct);
    }

    public async Task<ProgramView> AcknowledgeRest(Guid id, Guid templateId, ProgramDayActionInput input, CancellationToken ct)
    {
        await lifecycle.AcknowledgeRest(id, templateId, input, ct);
        return await Get(id, ct);
    }

    public async Task<ProgramView> ResetWeek(Guid id, ProgramWeekResetInput input, CancellationToken ct)
    {
        await lifecycle.ResetWeek(id, input, ct);
        return await Get(id, ct);
    }

    public async Task<ProgramView> Unskip(Guid id, Guid templateId, CancellationToken ct)
    {
        await lifecycle.Unskip(id, templateId, ct);
        return await Get(id, ct);
    }

    public Task<ProgramDayProgress> PendingWorkoutDay(Guid programId, Guid templateId, CancellationToken ct)
        => lifecycle.PendingWorkoutDay(programId, templateId, ct);

    public Task CompleteWorkout(WorkoutSession session, CancellationToken ct)
        => lifecycle.CompleteWorkout(session, ct);
    /// Repeating is an explicit fresh instance. Template and phase IDs are deliberately new so
    /// the new run cannot merge its completion history into the completed source program.
    public async Task<ProgramView> Repeat(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var source = await db.Programs.SingleOrDefaultAsync(p => p.Id == id, ct);
        Validation.Require(source != null, "That program no longer exists.", 404);
        var latestRun = await progress.LatestRun(id, ct);
        Validation.Require(source!.LifecycleStatus == ProgramLifecycle.Completed || latestRun?.CompletedAt is not null,
            "Only a completed program can be repeated.", 409);
        var sourceTemplates = await db.Templates.Where(t => t.ProgramId == id).OrderBy(t => t.Week).ThenBy(t => t.Position).ToListAsync(ct);
        var sourceIds = sourceTemplates.Select(t => t.Id).ToList();
        var sourceExercises = await db.TemplateExercises.Where(e => sourceIds.Contains(e.TemplateId)).OrderBy(e => e.Position).ToListAsync(ct);
        var fresh = new TrainingProgram
        {
            UserId = source.UserId, Name = source.Name, Weeks = source.Weeks,
            Active = false, LifecycleStatus = ProgramLifecycle.Standby, SourceImportId = source.SourceImportId
        };
        db.Programs.Add(fresh);
        var phases = await db.ProgramPhases.Where(p => p.ProgramId == id).OrderBy(p => p.Position).ToListAsync(ct);
        var copiedTemplates = new List<(WorkoutTemplate Original, WorkoutTemplate Copy)>();
        foreach (var original in sourceTemplates)
        {
            var copy = new WorkoutTemplate
            {
                UserId = fresh.UserId, ProgramId = fresh.Id, Name = original.Name, Focus = original.Focus, Note = original.Note,
                Week = original.Week, Position = original.Position, Block = original.Block, Phase = original.Phase,
                PhaseWeek = original.PhaseWeek, IsRestDay = original.IsRestDay, SourcePage = original.SourcePage,
                BaselineJson = original.BaselineJson
            };
            db.Templates.Add(copy);
            copiedTemplates.Add((original, copy));
            foreach (var exercise in sourceExercises.Where(e => e.TemplateId == original.Id))
                db.TemplateExercises.Add(new TemplateExercise
                {
                    UserId = fresh.UserId, TemplateId = copy.Id, ExerciseId = exercise.ExerciseId, SourceName = exercise.SourceName,
                    Position = exercise.Position, Note = exercise.Note, SetsJson = exercise.SetsJson,
                    SequenceGroup = exercise.SequenceGroup, SubstitutionsJson = exercise.SubstitutionsJson, SourcePage = exercise.SourcePage,
                    SlotKey = Guid.NewGuid()
                });
        }
        var newPhases = new List<ProgramPhase>();
        foreach (var phase in phases)
        {
            var copy = new ProgramPhase
            {
                UserId = fresh.UserId, ProgramId = fresh.Id, Position = phase.Position, Name = phase.Name, Block = phase.Block,
                WeekFrom = phase.WeekFrom, WeekTo = phase.WeekTo, DurationWeeks = phase.DurationWeeks,
                SourcePageFrom = phase.SourcePageFrom, SourcePageTo = phase.SourcePageTo
            };
            db.ProgramPhases.Add(copy); newPhases.Add(copy);
        }
        foreach (var (original, copy) in copiedTemplates)
        {
            var sourcePhasePosition = phases.FirstOrDefault(p => p.Id == original.ProgramPhaseId)?.Position;
            copy.ProgramPhaseId = sourcePhasePosition is { } phasePosition ? newPhases.FirstOrDefault(p => p.Position == phasePosition)?.Id :
                newPhases.FirstOrDefault(p => copy.Week >= p.WeekFrom && copy.Week <= p.WeekTo)?.Id;
        }
        await db.SaveChangesAsync(ct); await gate.Commit(ct);
        return await Get(fresh.Id, ct);
    }

    public async Task Delete(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var program = await db.Programs.SingleOrDefaultAsync(p => p.Id == id, ct);
        Validation.Require(program != null, "That program no longer exists.", 404);
        var ids = await db.Templates.Where(t => t.ProgramId == id).Select(t => t.Id).ToListAsync(ct);
        Validation.Require(!await db.Workouts.AnyAsync(w => w.Active && w.ProgramId == id, ct), "Finish or discard the active workout before deleting its program.", 409);
        db.TemplateExercises.RemoveRange(await db.TemplateExercises.Where(e => ids.Contains(e.TemplateId)).ToListAsync(ct));
        db.Templates.RemoveRange(await db.Templates.Where(t => t.ProgramId == id).ToListAsync(ct));
        db.ProgramPhases.RemoveRange(await db.ProgramPhases.Where(phase => phase.ProgramId == id).ToListAsync(ct));
        db.ProgramSkips.RemoveRange(await db.ProgramSkips.Where(skip => skip.ProgramId == id).ToListAsync(ct));
        var runIds = await db.ProgramRuns.Where(run => run.ProgramId == id).Select(run => run.Id).ToListAsync(ct);
        db.ProgramDayProgresses.RemoveRange(await db.ProgramDayProgresses.Where(day => runIds.Contains(day.RunId)).ToListAsync(ct));
        db.ProgramRuns.RemoveRange(await db.ProgramRuns.Where(run => run.ProgramId == id).ToListAsync(ct));
        // Finished sessions keep their own snapshots, so history survives the program going away.
        foreach (var session in await db.Workouts.Where(w => w.ProgramId == id).ToListAsync(ct))
        { session.ProgramId = null; session.TemplateId = null; session.ProgramDayProgressId = null; session.Revision++; }
        db.Programs.Remove(program!);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public async Task Validate(ProgramInput input, CancellationToken ct, bool allowMissingWorkingRpe = false)
    {
        Validation.Name(input.Name, "Program name");
        Validation.Require(input.Workouts is { Count: > 0 }, "A program needs at least one workout.");
        Validation.Require(input.Workouts.Count <= 400, "A program can have at most 400 workouts.");
        Validation.Require(input.Workouts.GroupBy(workout => workout.Week).All(week => week.Count() <= 7),
            "A program week can have at most 7 days.", 422);
        Validation.Require(input.Workouts.Any(workout => !workout.IsRestDay), "A program needs at least one training workout.");
        Validation.Require(input.Workouts.All(w => w.Week is > 0 and <= 104), "Program weeks must be between 1 and 104.");
        var programWeeks = input.Workouts.Select(workout => workout.Week).Distinct().Order().ToList();
        Validation.Require(programWeeks.SequenceEqual(Enumerable.Range(programWeeks[0], programWeeks.Count)),
            "Program weeks must be contiguous.", 422);
        foreach (var phase in GroupPhases(input.Workouts))
        {
            var phaseWeeks = phase.Select(workout => workout.PhaseWeek).Distinct().OrderBy(week => week).ToList();
            Validation.Require(phaseWeeks.SequenceEqual(Enumerable.Range(1, phaseWeeks.Count)), "A phase has a missing phase-relative week.", 422);
            var absoluteWeeks = phase.Select(workout => workout.Week).Distinct().OrderBy(week => week).ToList();
            Validation.Require(absoluteWeeks.SequenceEqual(Enumerable.Range(absoluteWeeks[0], absoluteWeeks[^1] - absoluteWeeks[0] + 1)), "A phase has a missing absolute week.", 422);
        }
        foreach (var workout in input.Workouts)
        {
            Validation.Require(workout.SourcePage is null || workout.SourcePage.Value is > 0 and <= ImportSourceText.MaxPages, "Workout source page is invalid.");
            await templates.ValidateInput(new TemplateInput(workout.Name, workout.Focus, workout.Note, workout.Exercises, null, null,
                workout.Block, workout.Phase, workout.PhaseWeek, workout.IsRestDay), ct, !allowMissingWorkingRpe);
        }
    }

    private static List<ProgramDayProgress> RelevantProgress(ProgramRun? run, IReadOnlyCollection<ProgramDayProgress> rows)
    {
        if (run is null) return [];
        return rows.Where(day => day.Week < run.CurrentWeek && day.Attempt == 1 ||
            day.Week == run.CurrentWeek && day.Attempt == run.CurrentAttempt).ToList();
    }

    private static ProgramProgressView? CreateProgressView(ProgramRun? run, IReadOnlyList<WorkoutTemplate> templates,
        IReadOnlyCollection<ProgramDayProgress> statuses)
    {
        if (run is null) return null;
        var statusByTemplate = statuses.Where(day => day.Week == run.CurrentWeek)
            .ToDictionary(day => day.TemplateId, day => day.Status);
        var days = templates.Where(template => template.Week == run.CurrentWeek).OrderBy(template => template.Position)
            .Select(template => new ProgramProgressDayView(template.Id,
                statusByTemplate.GetValueOrDefault(template.Id, ProgramDayStatus.Pending), template.IsRestDay, template.Position)).ToList();
        return new ProgramProgressView(run.Id, run.CurrentWeek, run.CurrentAttempt,
            days.Count(day => ProgramDayStatus.IsPassed(day.Status)), days.Count, days);
    }

    private async Task<List<ProgramPhaseView>> PhaseViews(Guid programId, List<WorkoutTemplate> rows, List<Guid> completed, List<Guid> skipped, CancellationToken ct)
    {
        var phases = await db.ProgramPhases.AsNoTracking().Where(p => p.ProgramId == programId).OrderBy(p => p.Position).ToListAsync(ct);
        if (phases.Count == 0 && rows.Count > 0)
        {
            // Backfill programs created before the phase table. The account lock closes the small
            // read/read race between two first views, while the original template IDs/order remain
            // untouched.
            await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
            phases = await db.ProgramPhases.AsNoTracking().Where(p => p.ProgramId == programId).OrderBy(p => p.Position).ToListAsync(ct);
            if (phases.Count == 0)
            {
                phases = AddBackfilledPhases(programId, db.CurrentUser!.Value, rows);
                await db.SaveChangesAsync(ct);
            }
            await gate.Commit(ct);
        }
        return BuildPhaseViews(phases, rows, completed, skipped);
    }

    private static List<ProgramPhaseView> BuildPhaseViews(IReadOnlyList<ProgramPhase> phases, IReadOnlyList<WorkoutTemplate> rows,
        IReadOnlyCollection<Guid> completed, IReadOnlyCollection<Guid> skipped)
    {
        return phases.Select(phase =>
        {
            var phaseRows = rows.Where(t => t.Week >= phase.WeekFrom && t.Week <= phase.WeekTo && !t.IsRestDay && BelongsToPhase(t, phase)).ToList();
            var ids = phaseRows.Select(t => t.Id).ToList();
            var skippedCount = ids.Count(id => skipped.Contains(id));
            var completedCount = ids.Count(id => completed.Contains(id));
            var done = completedCount + skippedCount;
            var restWindowComplete = ids.Count == 0;
            var current = phaseRows.FirstOrDefault(t => !completed.Contains(t.Id) && !skipped.Contains(t.Id))?.PhaseWeek ?? Math.Max(1, phase.DurationWeeks);
            return new ProgramPhaseView(phase.Id, phase.Name, phase.Block, phase.WeekFrom, phase.WeekTo, phase.DurationWeeks, completedCount, ids.Count, (ids.Count > 0 && done == ids.Count) || restWindowComplete, current, skippedCount, phase.SourcePageFrom, phase.SourcePageTo);
        }).ToList();
    }

    private static bool BelongsToPhase(WorkoutTemplate template, ProgramPhase phase)
    {
        var block = template.Block.Trim();
        var phaseName = template.Phase.Trim();
        if (!string.Equals(block, phase.Block.Trim(), StringComparison.OrdinalIgnoreCase)) return false;
        // CreatePhases uses the block as the display name when the source did not name a phase.
        if (string.IsNullOrWhiteSpace(phaseName))
            return string.Equals(phase.Name, "Program", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(phase.Name, phase.Block, StringComparison.OrdinalIgnoreCase);
        return string.Equals(phaseName, phase.Name, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPhaseComplete(ProgramPhase phase, IEnumerable<WorkoutTemplate> rows,
        IReadOnlySet<Guid> completed, IReadOnlySet<Guid> skipped)
    {
        var ids = rows.Where(template => !template.IsRestDay && template.Week >= phase.WeekFrom && template.Week <= phase.WeekTo && BelongsToPhase(template, phase)).Select(template => template.Id).ToList();
        if (ids.Count > 0) return ids.All(id => completed.Contains(id) || skipped.Contains(id));
        return true;
    }

    private List<ProgramPhase> AddBackfilledPhases(Guid programId, Guid userId, IEnumerable<WorkoutTemplate> rows)
    {
        var phases = new List<ProgramPhase>();
        var position = 0;
        foreach (var group in GroupTemplatePhases(rows))
        {
            var block = group[0].Block; var phaseName = group[0].Phase;
            var phase = new ProgramPhase { UserId = userId, ProgramId = programId, Position = position++,
                Name = string.IsNullOrWhiteSpace(phaseName) ? (string.IsNullOrWhiteSpace(block) ? "Program" : block) : phaseName,
                Block = block, WeekFrom = group.Min(t => t.Week), WeekTo = group.Max(t => t.Week), DurationWeeks = group.Max(t => t.Week) - group.Min(t => t.Week) + 1 };
            foreach (var template in group) template.ProgramPhaseId = phase.Id;
            db.ProgramPhases.Add(phase); phases.Add(phase);
        }
        return phases;
    }
}
