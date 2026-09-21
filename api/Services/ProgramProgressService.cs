using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

/// Persists the current run and monotonic day status for a program. Callers own the account
/// mutation lock and transaction so session completion and week advancement stay atomic.
public sealed class ProgramProgressService(AppDb db)
{
    public async Task<ProgramRun?> LatestRun(Guid programId, CancellationToken ct)
        => await db.ProgramRuns.Where(run => run.ProgramId == programId)
            .OrderByDescending(run => run.Number).FirstOrDefaultAsync(ct);

    public ProgramRun CreateRun(TrainingProgram program, IReadOnlyCollection<WorkoutTemplate> templates, int number)
    {
        var firstWeek = templates.Min(template => template.Week);
        var run = new ProgramRun
        {
            UserId = program.UserId,
            ProgramId = program.Id,
            Number = number,
            CurrentWeek = firstWeek,
            CurrentAttempt = 1
        };
        db.ProgramRuns.Add(run);
        AddPendingDays(program, run, templates.Where(template => template.Week == firstWeek), firstWeek, 1);
        return run;
    }

    public async Task<ProgramRun> EnsureLegacyRun(TrainingProgram program, IReadOnlyList<WorkoutTemplate> templates, CancellationToken ct)
    {
        var latest = await LatestRun(program.Id, ct);
        if (latest is not null) return latest;
        if (templates.Count == 0) throw new InvalidOperationException("A program run needs at least one day.");

        var completed = await db.Workouts.Where(workout => workout.ProgramId == program.Id && workout.FinishedAt != null && workout.TemplateId != null)
            .Select(workout => workout.TemplateId!.Value).Distinct().ToListAsync(ct);
        var skipped = await db.ProgramSkips.Where(skip => skip.ProgramId == program.Id)
            .Select(skip => skip.TemplateId).ToListAsync(ct);
        var activeSessions = await db.Workouts.Where(workout => workout.ProgramId == program.Id && workout.Active && workout.TemplateId != null)
            .ToListAsync(ct);
        var completedIds = completed.ToHashSet();
        var skippedIds = skipped.ToHashSet();
        var weeks = templates.Select(template => template.Week).Distinct().Order().ToList();
        var legacyCompleted = program.LifecycleStatus == ProgramLifecycle.Completed || program.CompletedAt is not null;
        var currentWeek = legacyCompleted
            ? weeks[^1]
            : weeks.FirstOrDefault(week =>
            {
                var days = templates.Where(template => template.Week == week).ToList();
                return days.All(day => day.IsRestDay) ||
                    days.Any(day => !day.IsRestDay && !completedIds.Contains(day.Id) && !skippedIds.Contains(day.Id));
            });
        if (currentWeek == 0) currentWeek = weeks[^1];

        var run = new ProgramRun
        {
            UserId = program.UserId,
            ProgramId = program.Id,
            Number = 1,
            CurrentWeek = currentWeek,
            CurrentAttempt = 1,
            CompletedAt = legacyCompleted ? program.CompletedAt ?? DateTime.UtcNow : null
        };
        db.ProgramRuns.Add(run);
        foreach (var template in templates)
        {
            var status = template.IsRestDay
                ? template.Week < currentWeek || legacyCompleted ? ProgramDayStatus.RestPassed : ProgramDayStatus.Pending
                : completedIds.Contains(template.Id) ? ProgramDayStatus.Completed
                : skippedIds.Contains(template.Id) ? ProgramDayStatus.Skipped
                : ProgramDayStatus.Pending;
            db.ProgramDayProgresses.Add(new ProgramDayProgress
            {
                UserId = program.UserId,
                ProgramId = program.Id,
                RunId = run.Id,
                TemplateId = template.Id,
                Week = template.Week,
                Attempt = 1,
                Status = status,
                PassedAt = ProgramDayStatus.IsPassed(status) ? DateTime.UtcNow : null
            });
        }
        foreach (var session in activeSessions)
        {
            var sessionTemplate = templates.FirstOrDefault(template => template.Id == session.TemplateId);
            var day = db.ProgramDayProgresses.Local.FirstOrDefault(candidate => candidate.RunId == run.Id &&
                candidate.TemplateId == session.TemplateId && candidate.Week == sessionTemplate?.Week && candidate.Attempt == 1);
            if (day is not null) session.ProgramDayProgressId = day.Id;
        }

        if (legacyCompleted)
        {
            program.Active = false;
            program.LifecycleStatus = ProgramLifecycle.Standby;
            program.CompletedAt = null;
            program.Revision++;
        }
        return run;
    }

    public async Task<List<ProgramDayProgress>> EnsureCurrentWeek(TrainingProgram program, ProgramRun run,
        IReadOnlyCollection<WorkoutTemplate> templates, CancellationToken ct)
    {
        var currentTemplates = templates.Where(template => template.Week == run.CurrentWeek).ToList();
        var existing = await db.ProgramDayProgresses.Where(row => row.RunId == run.Id && row.Week == run.CurrentWeek && row.Attempt == run.CurrentAttempt)
            .ToListAsync(ct);
        var persistedIds = existing.Select(row => row.Id).ToHashSet();
        existing.AddRange(db.ProgramDayProgresses.Local.Where(row => row.RunId == run.Id && row.Week == run.CurrentWeek &&
            row.Attempt == run.CurrentAttempt && !persistedIds.Contains(row.Id)));
        var existingIds = existing.Select(row => row.TemplateId).ToHashSet();
        foreach (var template in currentTemplates.Where(template => !existingIds.Contains(template.Id)))
        {
            var pending = new ProgramDayProgress
            {
                UserId = program.UserId,
                ProgramId = program.Id,
                RunId = run.Id,
                TemplateId = template.Id,
                Week = run.CurrentWeek,
                Attempt = run.CurrentAttempt
            };
            db.ProgramDayProgresses.Add(pending);
            existing.Add(pending);
        }
        return existing;
    }

    public async Task AdvanceIfWeekPassed(TrainingProgram program, ProgramRun run,
        IReadOnlyCollection<WorkoutTemplate> templates, CancellationToken ct)
    {
        if (run.CompletedAt is not null) return;
        var days = await EnsureCurrentWeek(program, run, templates, ct);
        var currentTemplates = templates.Where(template => template.Week == run.CurrentWeek).ToList();
        if (currentTemplates.Count == 0 || days.Count < currentTemplates.Count ||
            currentTemplates.Any(template => !days.Any(day => day.TemplateId == template.Id && ProgramDayStatus.IsPassed(day.Status))))
            return;

        var nextWeek = templates.Where(template => template.Week > run.CurrentWeek).Select(template => (int?)template.Week).Min();
        if (nextWeek is { } week)
        {
            run.CurrentWeek = week;
            run.CurrentAttempt = 1;
            run.Revision++;
            await EnsureCurrentWeek(program, run, templates, ct);
            return;
        }

        run.CompletedAt = DateTime.UtcNow;
        run.Revision++;
        program.Active = false;
        program.LifecycleStatus = ProgramLifecycle.Standby;
        program.CompletedAt = null;
        program.Revision++;
    }

    public static void Pass(ProgramDayProgress day, string status)
    {
        day.Status = status;
        day.PassedAt = DateTime.UtcNow;
        day.Revision++;
    }

    private void AddPendingDays(TrainingProgram program, ProgramRun run, IEnumerable<WorkoutTemplate> templates, int week, int attempt)
    {
        foreach (var template in templates)
            db.ProgramDayProgresses.Add(new ProgramDayProgress
            {
                UserId = program.UserId,
                ProgramId = program.Id,
                RunId = run.Id,
                TemplateId = template.Id,
                Week = week,
                Attempt = attempt
            });
    }
}
