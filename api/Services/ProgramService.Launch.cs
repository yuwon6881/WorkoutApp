using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

public sealed record ProgramLaunchView(Guid Id, string Name, int Weeks, bool Active, int Revision, Guid? SourceImportId,
    Guid? NextTemplateId, string LifecycleStatus, DateTime? CompletedAt, ProgramProgressView? Progress = null);
public sealed record NextWorkoutView(Guid Id, string Name, string Focus, int Week, int Position, int ExerciseCount);

public sealed partial class ProgramService
{
    public async Task<(ProgramLaunchView? Program, NextWorkoutView? Next)> Launch(CancellationToken ct)
    {
        var program = await db.Programs.AsNoTracking().Where(row => row.Active).OrderByDescending(row => row.Created).FirstOrDefaultAsync(ct);
        if (program is null) return (null, null);
        await lifecycle.EnsureActiveRun(program.Id, ct);
        program = await db.Programs.AsNoTracking().SingleAsync(row => row.Id == program.Id, ct);
        if (!program.Active) return (null, null);
        var run = await db.ProgramRuns.AsNoTracking().Where(row => row.ProgramId == program.Id)
            .OrderByDescending(row => row.Number).FirstOrDefaultAsync(ct);
        NextWorkoutView? next = null;
        ProgramProgressView? progress = null;
        if (run is { CompletedAt: null })
        {
            var weekTemplates = await db.Templates.AsNoTracking()
                .Where(day => day.ProgramId == program.Id && day.Week == run.CurrentWeek)
                .OrderBy(day => day.Position).ThenBy(day => day.Id).ToListAsync(ct);
            var statuses = await db.ProgramDayProgresses.AsNoTracking()
                .Where(state => state.RunId == run.Id && state.Attempt == run.CurrentAttempt && state.Week == run.CurrentWeek)
                .ToListAsync(ct);
            progress = CreateProgressView(run, weekTemplates, statuses);

            var nextTemplate = weekTemplates.FirstOrDefault(day => !day.IsRestDay &&
                statuses.Any(state => state.TemplateId == day.Id && state.Status == ProgramDayStatus.Pending));
            if (nextTemplate != null)
            {
                var exerciseCount = await db.TemplateExercises.CountAsync(exercise => exercise.TemplateId == nextTemplate.Id, ct);
                next = new NextWorkoutView(nextTemplate.Id, nextTemplate.Name, nextTemplate.Focus, nextTemplate.Week, nextTemplate.Position, exerciseCount);
            }
        }
        var summary = new ProgramLaunchView(program.Id, program.Name, program.Weeks, program.Active, program.Revision,
            program.SourceImportId, next?.Id, program.LifecycleStatus, program.CompletedAt, progress);
        return (summary, next);
    }
}
