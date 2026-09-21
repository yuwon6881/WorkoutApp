using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record WorkoutTimingInput(int? Revision, Guid? MutationId, DateTimeOffset OccurredAt);

public sealed partial class WorkoutService
{
    private sealed record FinishMutation(int? Revision, bool RetainExerciseSwaps, DateTimeOffset? FinishedAt);

    public Task<SessionView> Pause(Guid id, WorkoutTimingInput input, CancellationToken ct)
        => ChangePauseState(id, input, pause: true, ct);

    public Task<SessionView> Resume(Guid id, WorkoutTimingInput input, CancellationToken ct)
        => ChangePauseState(id, input, pause: false, ct);

    private async Task<SessionView> ChangePauseState(Guid id, WorkoutTimingInput input, bool pause, CancellationToken ct)
    {
        var operation = pause ? "workout.pause" : "workout.resume";
        var requestHash = Fingerprint(input);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(workout => workout.Id == id, ct);
        Validation.Require(session is not null, "That workout no longer exists.", 404);

        var replay = await ReplayWorkoutMutation(id, input.MutationId, operation, requestHash, ct);
        if (replay is not null)
        {
            await gate.Commit(ct);
            return replay;
        }

        Validation.Require(session!.Active, "This workout is already saved to your history.", 409);
        Validation.Require(input.MutationId is { } mutationId && mutationId != Guid.Empty,
            "A timing change needs an operation identity.");
        Validation.Require(input.Revision is not null, "The workout revision is required.", 409);
        TemplateService.RequireFresh(input.Revision, session.Revision);
        var occurredAt = ValidateWorkoutTime(input.OccurredAt, session, "The timing change");
        var previousEvent = session.LastTimingEventAt ?? session.StartedAt;
        Validation.Require(occurredAt >= previousEvent, "Workout timing changes must be applied in order.", 409);

        if (pause)
        {
            Validation.Require(session.PausedAt is null, "This workout is already paused.", 409);
            session.PausedAt = occurredAt;
        }
        else
        {
            var pausedAt = session.PausedAt;
            Validation.Require(pausedAt is not null, "This workout is not paused.", 409);
            Validation.Require(occurredAt >= pausedAt!.Value, "The resume time must follow the pause start.", 409);
            session.PausedSeconds += RoundedSeconds(occurredAt - pausedAt.Value);
            session.PausedAt = null;
        }

        session.LastTimingEventAt = occurredAt;
        session.Revision++;
        await RecordWorkoutMutation(input.MutationId, id, operation, requestHash, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    private static DateTime ResolveFinishedAt(WorkoutSession session, DateTimeOffset? requested)
    {
        if (requested is null) return DateTime.UtcNow;
        return ValidateWorkoutTime(requested.Value, session, "The finish time");
    }

    private static DateTime ValidateWorkoutTime(DateTimeOffset requested, WorkoutSession session, string label)
    {
        Validation.Require(requested != default, $"{label} is required.");
        var value = requested.UtcDateTime;
        Validation.Require(value >= session.StartedAt, $"{label} cannot be before the workout started.", 409);
        Validation.Require(value <= DateTime.UtcNow.AddMinutes(5), $"{label} cannot be in the future.", 409);
        return value;
    }

    private static long RoundedSeconds(TimeSpan duration)
        => Math.Max(0, (long)Math.Round(duration.TotalSeconds, MidpointRounding.AwayFromZero));
}
