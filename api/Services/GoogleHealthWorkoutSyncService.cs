using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record GoogleHealthWorkoutSyncStatus(
    bool Enabled,
    bool PermissionGranted,
    string State,
    int PendingCount,
    DateTime? LastSuccessfulSyncAt,
    long Revision,
    string? FailureCode = null,
    string? FailureMessage = null);

public sealed record GoogleHealthWorkoutSyncProcessResult(int Processed, int Succeeded, int Retried, int Failed, int Unknown);

public sealed record GoogleHealthWorkoutSyncRecoveryInput(Guid? WorkoutSessionId = null);

public sealed partial class GoogleHealthWorkoutSyncService(
    AppDb db,
    GoogleHealthService google,
    HttpClient http,
    GoogleHealthWorkoutSummaryService summary)
{
    public const string WorkoutScope = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly";
    private static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(2);

    public Task<string> BuildSummaryNotesAsync(Guid sessionId, CancellationToken ct)
        => summary.BuildSummaryNotesAsync(sessionId, ct);

    public async Task QueueWorkoutAsync(Guid sessionId, bool isDelete, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null) return;

        var work = await db.GoogleHealthWorkoutSyncWork.SingleOrDefaultAsync(x => x.WorkoutSessionId == sessionId, ct);
        var mapped = work is not null && !string.IsNullOrWhiteSpace(work.GoogleResourceName);
        var qualifiesAsNew = work is null && !isDelete;
        if (work is null && (!qualifiesAsNew || !CanDispatch(connection))) return;

        var session = await db.Workouts.AsNoTracking().SingleOrDefaultAsync(w => w.Id == sessionId, ct);
        var notes = isDelete ? "" : await BuildSummaryNotesAsync(sessionId, ct);

        if (work is null)
        {
            work = new GoogleHealthWorkoutSyncWork
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                WorkoutSessionId = sessionId,
                GoogleIdHash = connection.GoogleIdHash,
                ConnectionGeneration = connection.ConnectionGeneration,
                ProcessingState = "pending"
            };
            db.GoogleHealthWorkoutSyncWork.Add(work);
        }

        work.DesiredRevision = (work.DesiredRevision + 1);
        work.DesiredStartedAt = session?.StartedAt ?? DateTime.UtcNow;
        work.DesiredFinishedAt = session?.FinishedAt ?? DateTime.UtcNow;
        work.DesiredName = session?.Name ?? "Workout";
        work.DesiredNotes = notes;
        work.DesiredDeleted = isDelete;
        work.GoogleIdHash = connection.GoogleIdHash;
        work.ConnectionGeneration = connection.ConnectionGeneration;
        work.UpdatedAt = DateTime.UtcNow;

        if (isDelete && !mapped)
        {
            CancelWork(work);
            return;
        }

        if (!connection.WorkoutSyncEnabled || !CanDispatch(connection))
        {
            if (work.ProcessingState is "pending")
                CancelWork(work);
            return;
        }

        if (work.ProcessingState == "unknown") return;
        if (mapped || qualifiesAsNew)
        {
            work.ProcessingState = "pending";
            work.NextAttemptAt = DateTime.UtcNow;
            work.LeaseUntil = null;
            work.LeaseId = "";
            work.LastErrorCategory = "";
            work.LastErrorMessage = "";
        }
    }

    public async Task<GoogleHealthWorkoutSyncStatus> SetPreferenceAsync(bool enabled, long expectedRevision, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        Validation.Require(connection is not null, "Connect Google Health before changing workout synchronization.", 409);
        Validation.Require(connection!.WorkoutSyncRevision == expectedRevision, "Google Health settings changed on another device. Refresh and try again.", 409);
        Validation.Require(!enabled || HasWorkoutScope(connection), "Google Health did not grant the workout permission. Reconnect and allow workout synchronization.", 409);

        connection.WorkoutSyncEnabled = enabled;
        connection.WorkoutSyncRevision++;
        connection.Revision++;
        if (!enabled)
        {
            var pending = await db.GoogleHealthWorkoutSyncWork
                .Where(x => x.ProcessingState == "pending")
                .ToListAsync(ct);
            foreach (var work in pending) CancelWork(work);
        }

        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await GetStatusAsync(ct);
    }

    public async Task<GoogleHealthWorkoutSyncStatus> RecoverAsync(Guid? sessionId, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        Validation.Require(connection is not null, "Connect Google Health before recovering workout synchronization.", 409);
        Validation.Require(CanDispatch(connection!), "Enable workout synchronization after granting the Google Health workout permission.", 409);

        var query = db.GoogleHealthWorkoutSyncWork.Where(x => new[] { "unknown", "failed" }.Contains(x.ProcessingState));
        if (sessionId is not null) query = query.Where(x => x.WorkoutSessionId == sessionId.Value);
        var works = await query.ToListAsync(ct);
        foreach (var work in works)
        {
            work.ProcessingState = "pending";
            work.NextAttemptAt = DateTime.UtcNow;
            work.LeaseUntil = null;
            work.LeaseId = "";
            work.GoogleOperationName = "";
            work.LastErrorCategory = "";
            work.LastErrorMessage = "";
            work.RetryCount = 0;
            work.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await GetStatusAsync(ct);
    }

    public async Task<GoogleHealthWorkoutSyncStatus> GetStatusAsync(CancellationToken ct)
    {
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null)
            return new(false, false, "disabled", 0, null, 0);

        var work = await db.GoogleHealthWorkoutSyncWork.ToListAsync(ct);
        var pending = work.Count(x => x.ProcessingState is "pending" or "processing" or "awaiting_operation");
        var problem = work.Where(x => x.ProcessingState is "failed" or "unknown").OrderByDescending(x => x.UpdatedAt).FirstOrDefault();
        var state = !connection.WorkoutSyncEnabled ? "disabled"
            : connection.Status == "reconnect_required" ? "reconnect_required"
            : problem?.ProcessingState ?? (pending > 0 ? "pending" : "idle");
        return new(
            connection.WorkoutSyncEnabled,
            HasWorkoutScope(connection),
            state,
            pending,
            connection.WorkoutLastSuccessfulSyncAt,
            connection.WorkoutSyncRevision,
            problem?.LastErrorCategory,
            problem?.LastErrorMessage);
    }

    public async Task<GoogleHealthWorkoutSyncProcessResult> ProcessDueAsync(CancellationToken ct)
    {
        var started = DateTime.UtcNow;
        var candidates = await db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters()
            .Where(x => new[] { "pending", "processing", "awaiting_operation" }.Contains(x.ProcessingState)
                && x.NextAttemptAt <= started
                && (x.LeaseUntil == null || x.LeaseUntil < started))
            .OrderBy(x => x.NextAttemptAt)
            .ThenBy(x => x.CreatedAt)
            .Take(25)
            .Select(x => new { x.UserId, x.Id })
            .ToListAsync(ct);

        var processed = 0;
        var succeeded = 0;
        var retried = 0;
        var failed = 0;
        var unknown = 0;

        var originalCurrentUser = db.CurrentUser;
        foreach (var item in candidates)
        {
            if (ct.IsCancellationRequested) break;
            db.CurrentUser = item.UserId;
            try
            {
                var leaseId = Guid.NewGuid().ToString("N");
                var leased = await LeaseWorkAsync(item.UserId, item.Id, leaseId, started, ct);
                if (leased is null) continue;

                processed++;
                var result = await ProcessLeasedAsync(leased, ct);
                switch (result)
                {
                    case "succeeded": succeeded++; break;
                    case "retried": retried++; break;
                    case "failed": failed++; break;
                    case "unknown": unknown++; break;
                }
            }
            finally
            {
                db.CurrentUser = originalCurrentUser;
            }
        }

        return new(processed, succeeded, retried, failed, unknown);
    }

    private async Task<WorkoutWorkLease?> LeaseWorkAsync(Guid userId, Guid workId, string leaseId, DateTime now, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var work = await db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.UserId == userId && x.Id == workId, ct);
        if (work is null || !new[] { "pending", "processing", "awaiting_operation" }.Contains(work.ProcessingState)
            || work.NextAttemptAt > now || (work.LeaseUntil != null && work.LeaseUntil >= now))
            return null;

        // A crashed create may have reached Google even when its response was never saved.
        if (work.ProcessingState == "processing" && !work.DesiredDeleted
            && string.IsNullOrEmpty(work.GoogleResourceName) && string.IsNullOrEmpty(work.GoogleOperationName))
        {
            work.ProcessingState = "unknown";
            work.NextAttemptAt = DateTime.MaxValue;
            work.LeaseUntil = null;
            work.LeaseId = "";
            work.LastErrorCategory = "upload_status_unknown";
            work.LastErrorMessage = "The previous create may have reached Google Health. Check for a copy before retrying.";
            work.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            return null;
        }

        work.LeaseId = leaseId;
        work.LeaseUntil = now.Add(LeaseDuration);
        work.ProcessingState = string.IsNullOrEmpty(work.GoogleOperationName) ? "processing" : "awaiting_operation";
        work.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);

        return new WorkoutWorkLease(
            work.UserId,
            work.Id,
            work.LeaseId,
            work.DesiredRevision,
            work.DesiredStartedAt,
            work.DesiredFinishedAt,
            work.DesiredName,
            work.DesiredNotes,
            work.DesiredDeleted,
            work.GoogleResourceName,
            work.GoogleOperationName,
            work.ConnectionGeneration,
            work.GoogleIdHash);
    }

    private async Task<string> ProcessLeasedAsync(WorkoutWorkLease lease, CancellationToken ct)
    {
        var createMayHaveBeenSent = false;
        try
        {
            var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
            var identityMatches = connection is not null
                && connection.ConnectionGeneration == lease.ConnectionGeneration
                && connection.GoogleIdHash == lease.GoogleIdHash;
            var submittedOperation = !string.IsNullOrWhiteSpace(lease.OperationName);
            if (!identityMatches || (!CanDispatch(connection!) && !submittedOperation))
            {
                await CancelLeaseAsync(lease.UserId, lease.WorkId, lease.LeaseId, ct);
                return "failed";
            }

            var token = await google.GetAccessTokenAsync(lease.UserId, WorkoutScope, ct);
            if (string.IsNullOrWhiteSpace(token))
            {
                await FailLeaseAsync(lease.UserId, lease.WorkId, lease.LeaseId, "reconnect_required", "Google Health authorization expired. Reconnect to resume uploads.", ct);
                return "failed";
            }

            GoogleHealthOperationResult op;
            if (!string.IsNullOrEmpty(lease.OperationName))
            {
                op = await GoogleHealthWorkoutProvider.PollAsync(http, token, lease.OperationName, ct);
            }
            else if (lease.Deleted)
            {
                op = await GoogleHealthWorkoutProvider.DeleteAsync(http, token, lease.ResourceName, ct);
            }
            else
            {
                var payload = BuildDataPoint(lease.StartedAt, lease.FinishedAt, lease.Name, lease.Notes, null);
                createMayHaveBeenSent = string.IsNullOrEmpty(lease.ResourceName);
                op = string.IsNullOrEmpty(lease.ResourceName)
                    ? await GoogleHealthWorkoutProvider.CreateAsync(http, token, payload, ct)
                    : await GoogleHealthWorkoutProvider.UpdateAsync(http, token, lease.ResourceName, payload, ct);
            }

            if (!string.IsNullOrEmpty(op.ErrorCategory))
            {
                if (op.ErrorCategory == "reconnect_required")
                    await google.MarkReconnectRequiredAsync(lease.UserId, ct);
                await FailLeaseAsync(lease.UserId, lease.WorkId, lease.LeaseId, op.ErrorCategory, op.ErrorMessage ?? "Google Health rejected the workout.", ct);
                return "failed";
            }

            if (op.Done)
            {
                await CompleteLeaseAsync(lease.UserId, lease.WorkId, lease.LeaseId, op.ResourceName, ct);
                return "succeeded";
            }
            else
            {
                await ContinueOperationAsync(lease.UserId, lease.WorkId, lease.LeaseId, op.OperationName, ct);
                return "retried";
            }
        }
        catch (GoogleHealthWorkoutProviderException ex) when (ex.UnknownCreate)
        {
            await MarkUnknownAsync(lease.UserId, lease.WorkId, lease.LeaseId, ct);
            return "unknown";
        }
        catch (GoogleHealthWorkoutProviderException ex) when (ex.Transient)
        {
            await RetryLeaseAsync(lease.UserId, lease.WorkId, lease.LeaseId, ex.RetryAfter, ct);
            return "retried";
        }
        catch (GoogleHealthWorkoutProviderException ex)
        {
            if (ex.AuthenticationFailure)
                await google.MarkReconnectRequiredAsync(lease.UserId, ct);
            await FailLeaseAsync(lease.UserId, lease.WorkId, lease.LeaseId, ex.Category, ex.Message, ct);
            return "failed";
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            if (createMayHaveBeenSent)
            {
                await MarkUnknownAsync(lease.UserId, lease.WorkId, lease.LeaseId, ct);
                return "unknown";
            }
            await RetryLeaseAsync(lease.UserId, lease.WorkId, lease.LeaseId, null, ct);
            return "retried";
        }
    }

    private async Task CompleteLeaseAsync(Guid userId, Guid workId, string leaseId, string? resourceName, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var work = await db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.UserId == userId && x.Id == workId && x.LeaseId == leaseId, ct);
        if (work is null) return;

        if (work.DesiredDeleted)
        {
            db.GoogleHealthWorkoutSyncWork.Remove(work);
        }
        else
        {
            work.ProcessingState = "succeeded";
            work.NextAttemptAt = DateTime.MaxValue;
            work.LeaseUntil = null;
            work.LeaseId = "";
            work.GoogleOperationName = "";
            work.RetryCount = 0;
            work.LastErrorCategory = "";
            work.LastErrorMessage = "";
            work.LastSuccessfulSyncAt = DateTime.UtcNow;
            work.UpdatedAt = DateTime.UtcNow;
            if (!string.IsNullOrEmpty(resourceName))
                work.GoogleResourceName = resourceName;
        }

        var conn = await db.GoogleHealthConnections.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.UserId == userId, ct);
        if (conn is not null)
        {
            conn.WorkoutLastSuccessfulSyncAt = DateTime.UtcNow;
            conn.LastSyncedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task ContinueOperationAsync(Guid userId, Guid workId, string leaseId, string? opName, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var work = await db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.UserId == userId && x.Id == workId && x.LeaseId == leaseId, ct);
        if (work is null) return;

        work.ProcessingState = "awaiting_operation";
        work.GoogleOperationName = opName ?? work.GoogleOperationName;
        work.NextAttemptAt = DateTime.UtcNow.AddSeconds(10);
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task RetryLeaseAsync(Guid userId, Guid workId, string leaseId, TimeSpan? retryAfter, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var work = await db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.UserId == userId && x.Id == workId && x.LeaseId == leaseId, ct);
        if (work is null) return;

        work.RetryCount = Math.Min(work.RetryCount + 1, 8);
        var delay = retryAfter ?? TimeSpan.FromSeconds(Math.Min(3600, Math.Pow(2, work.RetryCount) * 15));
        work.ProcessingState = "pending";
        work.NextAttemptAt = DateTime.UtcNow.Add(delay);
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = "provider_unavailable";
        work.LastErrorMessage = "Google Health temporarily rejected the upload. It will retry automatically.";
        work.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task FailLeaseAsync(Guid userId, Guid workId, string leaseId, string category, string message, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var work = await db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.UserId == userId && x.Id == workId && x.LeaseId == leaseId, ct);
        if (work is null) return;

        work.ProcessingState = "failed";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = category;
        work.LastErrorMessage = message;
        work.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task CancelLeaseAsync(Guid userId, Guid workId, string leaseId, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var work = await db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.UserId == userId && x.Id == workId && x.LeaseId == leaseId, ct);
        if (work is null) return;
        CancelWork(work);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task MarkUnknownAsync(Guid userId, Guid workId, string leaseId, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var work = await db.GoogleHealthWorkoutSyncWork.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.UserId == userId && x.Id == workId && x.LeaseId == leaseId, ct);
        if (work is null) return;

        work.ProcessingState = "unknown";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = "upload_status_unknown";
        work.LastErrorMessage = "The create response was lost. Check Google Health for a copy before requesting another upload.";
        work.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

}
