using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

public sealed record ProgramLaunchView(Guid Id, string Name, int Weeks, bool Active, int Revision, Guid? SourceImportId,
    Guid? NextTemplateId, string LifecycleStatus, DateTime? CompletedAt);
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
        if (run is { CompletedAt: null })
            next = await db.Templates.AsNoTracking().Where(day => day.ProgramId == program.Id && day.Week == run.CurrentWeek && !day.IsRestDay &&
                db.ProgramDayProgresses.Any(state => state.RunId == run.Id && state.TemplateId == day.Id &&
                    state.Attempt == run.CurrentAttempt && state.Status == ProgramDayStatus.Pending))
                .OrderBy(day => day.Position).ThenBy(day => day.Id)
                .Select(day => new NextWorkoutView(day.Id, day.Name, day.Focus, day.Week, day.Position,
                    db.TemplateExercises.Count(exercise => exercise.TemplateId == day.Id))).FirstOrDefaultAsync(ct);
        var summary = new ProgramLaunchView(program.Id, program.Name, program.Weeks, program.Active, program.Revision,
            program.SourceImportId, next?.Id, program.LifecycleStatus, program.CompletedAt);
        return (summary, next);
    }
}
