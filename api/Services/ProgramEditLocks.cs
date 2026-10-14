using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// What an activated program's run has already used up. Weeks before the current week and the
/// days passed in the current week (done, skipped, or a rest day ticked off) are history: they can
/// no longer be edited, moved, or removed. A program outside the active slot has no run, so
/// nothing in it is locked.
public sealed class ProgramLockState
{
    public static readonly ProgramLockState Unlocked = new(false, false, 0, new HashSet<Guid>(), new HashSet<Guid>());

    public ProgramLockState(bool runInProgress, bool runFinished, int currentWeek,
        IReadOnlySet<Guid> passedTemplateIds, IReadOnlySet<Guid> openTemplateIds)
    {
        RunInProgress = runInProgress;
        RunFinished = runFinished;
        CurrentWeek = currentWeek;
        PassedTemplateIds = passedTemplateIds;
        OpenTemplateIds = openTemplateIds;
    }

    /// The program holds the active slot with a run still going.
    public bool RunInProgress { get; }
    /// Every week of the run has been passed; the program waits to be restarted or shelved.
    public bool RunFinished { get; }
    public int CurrentWeek { get; }
    public IReadOnlySet<Guid> PassedTemplateIds { get; }
    /// Days with an unfinished workout: still editable, but they cannot be removed or moved away
    /// because the open session points at them.
    public IReadOnlySet<Guid> OpenTemplateIds { get; }

    public bool IsLocked(WorkoutTemplate day) => IsLocked(day.Id, day.Week);

    public bool IsLocked(Guid dayId, int week)
        => RunFinished || (RunInProgress && (week < CurrentWeek || PassedTemplateIds.Contains(dayId)));

    public bool IsPinned(Guid dayId) => OpenTemplateIds.Contains(dayId);

    public static async Task<ProgramLockState> Load(AppDb db, Guid programId, CancellationToken ct)
    {
        var program = await db.Programs.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.Id == programId, ct);
        if (program is not { Active: true }) return Unlocked;
        var run = await db.ProgramRuns.AsNoTracking().Where(candidate => candidate.ProgramId == programId)
            .OrderByDescending(candidate => candidate.Number).FirstOrDefaultAsync(ct);
        // A legacy active program has no run until its next read repairs it; nothing is recorded
        // as passed, so nothing can be locked yet.
        if (run is null) return Unlocked;

        var rows = await db.ProgramDayProgresses.AsNoTracking().Where(day => day.RunId == run.Id).ToListAsync(ct);
        // A reset week keeps its abandoned attempts; only the latest attempt of an earlier week
        // and the live attempt of this one describe what was really passed.
        var latestAttempt = rows.Where(day => day.Week < run.CurrentWeek).GroupBy(day => day.Week)
            .ToDictionary(week => week.Key, week => week.Max(day => day.Attempt));
        var passed = rows.Where(day => ProgramDayStatus.IsPassed(day.Status) &&
                (day.Week < run.CurrentWeek && day.Attempt == latestAttempt[day.Week] ||
                 day.Week == run.CurrentWeek && day.Attempt == run.CurrentAttempt))
            .Select(day => day.TemplateId).ToHashSet();
        var open = await db.Workouts.AsNoTracking()
            .Where(workout => workout.ProgramId == programId && workout.Active && workout.TemplateId != null)
            .Select(workout => workout.TemplateId!.Value).ToHashSetAsync(ct);
        return new ProgramLockState(true, run.CompletedAt is not null, run.CurrentWeek, passed, open);
    }

    /// The lock state of the program a day belongs to, or none for a standalone workout.
    public static async Task<ProgramLockState> ForTemplate(AppDb db, WorkoutTemplate day, CancellationToken ct)
        => day.ProgramId is { } programId ? await Load(db, programId, ct) : Unlocked;
}
