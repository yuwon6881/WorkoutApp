using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// `Generation` names the rest this request creates; `ExpectedGeneration` is the rest the client
/// last saw on the server, so a stale request can rebase unless the rest itself changed meanwhile.
/// `OccurredAt` is when the lifter acted: a replayed request keeps its original deadline.
public sealed record WorkoutRestMutationInput(
    int? Revision,
    Guid? MutationId,
    string Action,
    int? Seconds = null,
    string? Generation = null,
    string? OriginDeviceId = null,
    DateTimeOffset? OccurredAt = null,
    string? ExpectedGeneration = null);

public sealed partial class WorkoutService
{
    private static readonly string[] RestActions = ["start", "extend", "shorten", "skip", "pause", "resume"];

    public async Task<SessionView> MutateRest(Guid sessionId, WorkoutRestMutationInput input, CancellationToken ct)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(input.Action), "The rest action is required.");
        var action = input.Action.Trim().ToLowerInvariant();
        Validation.Require(RestActions.Contains(action),
            "Rest action must be start, extend, shorten, skip, pause, or resume.");

        var requestHash = Fingerprint(input);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == sessionId, ct);
        Validation.Require(session != null, "That workout no longer exists.", 404);

        var replay = await ReplayWorkoutMutation(sessionId, input.MutationId, "workout.rest.mutate", requestHash, ct);
        if (replay is not null)
        {
            await gate.Commit(ct);
            return replay;
        }

        Validation.Require(session!.Active, "This workout is already saved to your history.", 409);
        Validation.Require(input.Revision is not null, "The workout revision is required.", 409);
        // Unrelated set or timing edits rebase; a rest that changed since the client last saw it
        // is never silently replaced.
        Validation.Require(input.Revision == session.Revision || SameGeneration(input.ExpectedGeneration, session.RestGeneration),
            "Rest state changed on another device. Review both versions before saving.", 409);

        var at = RestTime(input.OccurredAt, session);
        if (ApplyRestTransition(session, action, input.Seconds, input.Generation, input.OriginDeviceId, at))
            session.Revision++;

        await RecordWorkoutMutation(input.MutationId, sessionId, "workout.rest.mutate", requestHash, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(sessionId, ct);
    }

    private static bool SameGeneration(string? left, string? right)
        => string.Equals(string.IsNullOrWhiteSpace(left) ? null : left, string.IsNullOrWhiteSpace(right) ? null : right, StringComparison.Ordinal);

    /// A late replay is valued at the time it happened; clock skew never places a deadline ahead
    /// of the server's present by more than the skew the timing checks already allow.
    private static DateTime RestTime(DateTimeOffset? occurredAt, WorkoutSession session)
    {
        var now = DateTime.UtcNow;
        if (occurredAt is null) return now;
        var value = ValidateWorkoutTime(occurredAt.Value, session, "The rest change");
        return value > now ? now : value;
    }

    /// Applies one rest transition at `at` and reports whether the rest changed. Callers own the
    /// revision so a set and the rest it starts commit as one revision.
    private static bool ApplyRestTransition(
        WorkoutSession session,
        string action,
        int? seconds,
        string? generation,
        string? originDeviceId,
        DateTime at)
    {
        string NextGeneration() => !string.IsNullOrWhiteSpace(generation) ? generation : Guid.NewGuid().ToString("N");

        switch (action)
        {
            case "start":
                var duration = Math.Max(1, seconds ?? 90);
                session.RestStatus = WorkoutRestStatus.Running;
                session.RestDurationMs = duration * 1000L;
                session.RestDeadlineUtc = at.AddSeconds(duration);
                session.RestPausedRemainingMs = 0;
                session.RestGeneration = NextGeneration();
                session.RestOriginDeviceId = originDeviceId;
                return true;

            case "extend":
                var extension = Math.Max(1, seconds ?? 30) * 1000L;
                if (session.RestStatus == WorkoutRestStatus.Paused)
                {
                    session.RestPausedRemainingMs = (session.RestPausedRemainingMs ?? 0) + extension;
                }
                else if (session.RestStatus == WorkoutRestStatus.Running && session.RestDeadlineUtc is { } deadline)
                {
                    session.RestDeadlineUtc = (deadline > at ? deadline : at).AddMilliseconds(extension);
                }
                else return false;
                session.RestDurationMs = (session.RestDurationMs ?? 0) + extension;
                session.RestGeneration = NextGeneration();
                return true;

            case "shorten":
                var cut = Math.Max(1, seconds ?? 15) * 1000L;
                if (session.RestStatus == WorkoutRestStatus.Paused)
                {
                    var remaining = (session.RestPausedRemainingMs ?? 0) - cut;
                    if (remaining <= 0) ClearRest(session);
                    else { session.RestPausedRemainingMs = remaining; session.RestGeneration = NextGeneration(); }
                    return true;
                }
                if (session.RestStatus == WorkoutRestStatus.Running && session.RestDeadlineUtc is { } current)
                {
                    var shortened = current.AddMilliseconds(-cut);
                    if (shortened <= at) ClearRest(session);
                    else { session.RestDeadlineUtc = shortened; session.RestGeneration = NextGeneration(); }
                    return true;
                }
                return false;

            case "pause":
                if (session.RestStatus != WorkoutRestStatus.Running || session.RestDeadlineUtc is not { } running) return false;
                // A rest that had already ended is finished, not paused with nothing left.
                if (running <= at) { session.RestStatus = WorkoutRestStatus.Elapsed; return true; }
                session.RestStatus = WorkoutRestStatus.Paused;
                session.RestPausedRemainingMs = Math.Max(0, (long)(running - at).TotalMilliseconds);
                session.RestDeadlineUtc = null;
                session.RestGeneration = NextGeneration();
                return true;

            case "resume":
                if (session.RestStatus != WorkoutRestStatus.Paused || (session.RestPausedRemainingMs ?? 0) <= 0) return false;
                session.RestStatus = WorkoutRestStatus.Running;
                session.RestDeadlineUtc = at.AddMilliseconds(session.RestPausedRemainingMs!.Value);
                session.RestPausedRemainingMs = 0;
                session.RestGeneration = NextGeneration();
                return true;

            case "skip":
                if (session.RestStatus == WorkoutRestStatus.Idle && session.RestGeneration is null) return false;
                ClearRest(session);
                session.RestDurationMs = 0;
                return true;

            default:
                return false;
        }
    }

    private static void ClearRest(WorkoutSession session)
    {
        session.RestStatus = WorkoutRestStatus.Idle;
        session.RestDeadlineUtc = null;
        session.RestPausedRemainingMs = 0;
        session.RestGeneration = null;
    }
}
