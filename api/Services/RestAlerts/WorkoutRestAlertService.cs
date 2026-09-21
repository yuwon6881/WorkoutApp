using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services.RestAlerts;

/// <summary>Owns per-device rest-alert subscriptions, durable schedule intents, and task dispatch.</summary>
public sealed class WorkoutRestAlertService(
    AppDb db,
    IWorkoutRestTaskQueue tasks,
    IWorkoutPushSender push,
    ILogger<WorkoutRestAlertService> logger)
{
    private static readonly TimeSpan AlertLifetime = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan DispatchLease = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan ScheduleHorizon = TimeSpan.FromHours(24);
    private const int RecoveryBatchSize = 100;

    public async Task<RestAlertDeviceStatus> Status(string deviceId, Guid? sessionId, CancellationToken ct)
    {
        ValidateDeviceId(deviceId);
        var configured = tasks.Configured && push.Configured;
        var registered = await db.WorkoutPushDevices.AnyAsync(x => x.DeviceId == deviceId, ct);
        Guid? currentGeneration = null;
        if (registered && sessionId is { } session)
        {
            var now = DateTime.UtcNow;
            currentGeneration = await db.WorkoutRestAlertSchedules
                .Where(x => x.SessionId == session && x.DeviceId == deviceId && ActiveStatuses.Contains(x.Status) &&
                    x.Deadline > now && x.ExpiresAt > now)
                .OrderByDescending(x => x.CreatedAt).Select(x => (Guid?)x.Generation).FirstOrDefaultAsync(ct);
        }

        var message = !configured ? "Closed-app rest alerts are unavailable until push delivery is configured." :
            !registered ? "Enable notifications on this device to receive rest alerts." :
            "This device is registered for private rest alerts.";
        return new(configured, registered, currentGeneration, message);
    }

    public async Task<RestAlertDeviceStatus> Register(string deviceId, string token, CancellationToken ct)
    {
        ValidateDeviceId(deviceId);
        Validation.Require(!string.IsNullOrWhiteSpace(token) && token.Length <= 4096,
            "This browser did not provide a valid push registration.", 400);
        Validation.Require(tasks.Configured && push.Configured,
            "Closed-app rest alerts are not configured on the server yet.", 503);

        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var row = await db.WorkoutPushDevices.SingleOrDefaultAsync(x => x.DeviceId == deviceId, ct);
            if (row is null)
                db.WorkoutPushDevices.Add(new WorkoutPushDevice { UserId = db.CurrentUser!.Value, DeviceId = deviceId, FcmToken = token });
            else { row.FcmToken = token; row.UpdatedAt = DateTime.UtcNow; }
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        return await Status(deviceId, null, ct);
    }

    public async Task Unregister(string deviceId, CancellationToken ct)
    {
        ValidateDeviceId(deviceId);
        List<string> names;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var rows = await db.WorkoutRestAlertSchedules
                .Where(x => x.DeviceId == deviceId && ActiveStatuses.Contains(x.Status)).ToListAsync(ct);
            foreach (var row in rows) { row.Status = WorkoutRestAlertStatus.Cancelled; row.UpdatedAt = DateTime.UtcNow; }
            names = rows.Select(x => x.TaskName).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
            var subscription = await db.WorkoutPushDevices.SingleOrDefaultAsync(x => x.DeviceId == deviceId, ct);
            if (subscription is not null) db.WorkoutPushDevices.Remove(subscription);
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        await DeleteTasks(names, ct);
    }

    public async Task<WorkoutRestAlertScheduleResult> Schedule(
        Guid sessionId, RestAlertScheduleInput input, CancellationToken ct)
    {
        ValidateDeviceId(input.DeviceId);
        Validation.Require(input.Generation != Guid.Empty, "A rest-timer generation is required.", 400);
        var deadline = input.Deadline.UtcDateTime;
        var now = DateTime.UtcNow;
        Validation.Require(deadline <= now + ScheduleHorizon, "That rest-timer deadline is too far in the future.", 400);
        if (deadline <= now) return new(false, null, "The rest timer has already ended; its foreground alert remains available when the app is open.");
        if (!tasks.Configured || !push.Configured) return new(false, null, "Closed-app rest alerts are unavailable; the on-screen timer still works.");

        WorkoutRestAlertSchedule schedule;
        List<string> oldTaskNames;
        var userId = db.CurrentUser!.Value;
        await using (var gate = await MutationLock.Acquire(db, userId, ct))
        {
            var user = await db.Users.SingleAsync(x => x.Id == userId, ct);
            Validation.Require(user.RestAlerts, "Rest alerts are turned off for this account.", 409);
            var session = await db.Workouts.SingleOrDefaultAsync(x => x.Id == sessionId, ct);
            Validation.Require(session is { Active: true, PausedAt: null }, "This workout is no longer running.", 409);
            Validation.Require(await db.WorkoutPushDevices.AnyAsync(x => x.DeviceId == input.DeviceId, ct),
                "Enable rest alerts on this device first.", 409);

            var current = await db.WorkoutRestAlertSchedules
                .Where(x => x.SessionId == sessionId && x.DeviceId == input.DeviceId && ActiveStatuses.Contains(x.Status) &&
                    x.Deadline > now && x.ExpiresAt > now)
                .OrderByDescending(x => x.CreatedAt).FirstOrDefaultAsync(ct);
            Validation.Require(current?.Generation == input.ExpectedGeneration,
                "A different rest timer is already scheduled from another Workout window. The on-screen timer remains available; reopen this workout before trying again.", 409);

            var existing = await db.WorkoutRestAlertSchedules.SingleOrDefaultAsync(x => x.SessionId == sessionId &&
                x.DeviceId == input.DeviceId && x.Generation == input.Generation, ct);
            if (existing is not null)
            {
                Validation.Require(existing.Deadline == deadline,
                    "This rest-timer generation was already used with a different deadline.", 409);
                if (existing.Status == WorkoutRestAlertStatus.Scheduled)
                {
                    await gate.Commit(ct);
                    return new(true, existing.Generation, "A closed-app rest alert is scheduled for this device.");
                }
                Validation.Require(existing.Status == WorkoutRestAlertStatus.Pending,
                    "This rest-timer generation is no longer active.", 409);
                schedule = existing;
                oldTaskNames = [];
            }
            else
            {
                var obsolete = await db.WorkoutRestAlertSchedules
                    .Where(x => x.SessionId == sessionId && x.DeviceId == input.DeviceId && ActiveStatuses.Contains(x.Status))
                    .ToListAsync(ct);
                foreach (var old in obsolete) { old.Status = WorkoutRestAlertStatus.Cancelled; old.UpdatedAt = now; }
                oldTaskNames = obsolete.Select(x => x.TaskName).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
                schedule = new WorkoutRestAlertSchedule
                {
                    UserId = userId,
                    SessionId = sessionId,
                    DeviceId = input.DeviceId,
                    Generation = input.Generation,
                    Deadline = deadline,
                    ExpiresAt = deadline + AlertLifetime,
                    Status = WorkoutRestAlertStatus.Pending,
                    TaskName = ""
                };
                db.WorkoutRestAlertSchedules.Add(schedule);
                // Task names are derived from the persisted schedule id; set it before saving so
                // an idempotent Cloud Tasks retry uses the exact same task identity.
                schedule.TaskName = tasks.TaskName(schedule.Id);
            }
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }

        await DeleteTasks(oldTaskNames, ct);
        if (!await tasks.EnsureTaskAsync(schedule, ct))
            return new(false, schedule.Generation, "The on-screen timer is active, but its closed-app alert could not be scheduled yet.");

        var scheduled = await ConfirmTaskScheduled(schedule.Id, ct);
        if (!scheduled) await tasks.DeleteTaskAsync(schedule.TaskName, ct);
        return scheduled
            ? new(true, schedule.Generation, "A closed-app rest alert is scheduled for this device.")
            : new(false, schedule.Generation, "The rest timer changed before its closed-app alert was confirmed. The on-screen timer still works.");
    }

    public async Task Cancel(Guid sessionId, RestAlertCancelInput input, CancellationToken ct)
    {
        ValidateDeviceId(input.DeviceId);
        Validation.Require(input.Generation != Guid.Empty, "A rest-timer generation is required.", 400);
        string? taskName = null;
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var row = await db.WorkoutRestAlertSchedules.SingleOrDefaultAsync(x => x.SessionId == sessionId &&
                x.DeviceId == input.DeviceId && x.Generation == input.Generation && ActiveStatuses.Contains(x.Status), ct);
            if (row is null) return;
            row.Status = WorkoutRestAlertStatus.Cancelled;
            row.UpdatedAt = DateTime.UtcNow;
            taskName = row.TaskName;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        if (!string.IsNullOrWhiteSpace(taskName)) await tasks.DeleteTaskAsync(taskName, ct);
    }

    /// <summary>Cloud Task target. A successful FCM response means provider acceptance only.</summary>
    public async Task<RestAlertTaskResult> Dispatch(Guid scheduleId, CancellationToken ct)
    {
        db.MaintenanceAccess = true;
        var snapshot = await db.WorkoutRestAlertSchedules.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.Id == scheduleId, ct);
        if (snapshot is null) return new("obsolete");
        db.CurrentUser = snapshot.UserId;
        string token;
        var now = DateTime.UtcNow;

        await using (var gate = await MutationLock.Acquire(db, snapshot.UserId, ct))
        {
            var row = await db.WorkoutRestAlertSchedules.SingleOrDefaultAsync(x => x.Id == scheduleId, ct);
            if (row is null || row.Status is WorkoutRestAlertStatus.Cancelled or WorkoutRestAlertStatus.Disabled or
                WorkoutRestAlertStatus.Expired or WorkoutRestAlertStatus.Failed or WorkoutRestAlertStatus.Accepted)
                return new("obsolete");
            if (row.Status == WorkoutRestAlertStatus.Dispatching && row.LeaseUntil > now) return new("retry");
            if (row.ExpiresAt <= now)
            {
                row.Status = WorkoutRestAlertStatus.Expired;
                row.UpdatedAt = now;
                await db.SaveChangesAsync(ct);
                await gate.Commit(ct);
                return new("expired");
            }
            if (row.Deadline > now) return new("retry");

            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == row.UserId, ct);
            var session = await db.Workouts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == row.SessionId, ct);
            var device = await db.WorkoutPushDevices.AsNoTracking().SingleOrDefaultAsync(x => x.DeviceId == row.DeviceId, ct);
            if (user is null || !user.RestAlerts || session is not { Active: true, PausedAt: null } || device is null)
            {
                row.Status = user is { RestAlerts: false } || device is null
                    ? WorkoutRestAlertStatus.Disabled : WorkoutRestAlertStatus.Cancelled;
                row.UpdatedAt = now;
                await db.SaveChangesAsync(ct);
                await gate.Commit(ct);
                return new("obsolete");
            }

            // Claim the generation before calling the provider. A duplicate task invocation is
            // acknowledged while the lease is live; an expired lease permits Cloud Tasks retry.
            row.Status = WorkoutRestAlertStatus.Dispatching;
            row.LeaseUntil = now + DispatchLease;
            row.UpdatedAt = now;
            token = device.FcmToken;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }

        var ttl = snapshot.ExpiresAt - DateTime.UtcNow;
        if (ttl <= TimeSpan.Zero) return await SetExpired(scheduleId, ct);
        var result = await Send(token, new WorkoutPushContent(
            "Rest timer", "Your rest is over. Open Workout to continue.",
            $"workout-rest-{snapshot.SessionId:N}", $"/?workout={Uri.EscapeDataString(snapshot.SessionId.ToString())}", ttl,
            snapshot.SessionId.ToString(), snapshot.Generation.ToString()), ct);

        await using (var gate = await MutationLock.Acquire(db, snapshot.UserId, ct))
        {
            var row = await db.WorkoutRestAlertSchedules.SingleOrDefaultAsync(x => x.Id == scheduleId, ct);
            if (row is null || row.Status != WorkoutRestAlertStatus.Dispatching) return new("cancelled-during-send");
            row.LeaseUntil = null;
            row.UpdatedAt = DateTime.UtcNow;
            if (result.Status == WorkoutPushSendStatus.Accepted)
            {
                row.Status = WorkoutRestAlertStatus.Accepted;
                row.AcceptedAt = DateTime.UtcNow;
            }
            else if (result.Status == WorkoutPushSendStatus.InvalidOrUnregistered)
            {
                row.Status = WorkoutRestAlertStatus.Disabled;
                var device = await db.WorkoutPushDevices.SingleOrDefaultAsync(x => x.DeviceId == row.DeviceId, ct);
                if (device is not null && device.FcmToken == token) db.WorkoutPushDevices.Remove(device);
            }
            else row.Status = row.ExpiresAt > DateTime.UtcNow ? WorkoutRestAlertStatus.Scheduled : WorkoutRestAlertStatus.Expired;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        return result.Status == WorkoutPushSendStatus.TransientFailure ? new("retry") : new("complete");
    }

    /// <summary>Repairs durable pending intents after transient Cloud Tasks API failures.</summary>
    public async Task<int> Recover(CancellationToken ct)
    {
        if (!tasks.Configured || !push.Configured) return 0;
        db.MaintenanceAccess = true;
        var now = DateTime.UtcNow;
        await db.WorkoutRestAlertSchedules.IgnoreQueryFilters()
            .Where(x => (x.Status == WorkoutRestAlertStatus.Pending || x.Status == WorkoutRestAlertStatus.Scheduled) && x.ExpiresAt <= now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.Status, WorkoutRestAlertStatus.Expired)
                .SetProperty(x => x.UpdatedAt, now), ct);
        await db.WorkoutRestAlertSchedules.IgnoreQueryFilters()
            .Where(x => x.Status == WorkoutRestAlertStatus.Dispatching && x.ExpiresAt <= now && (x.LeaseUntil == null || x.LeaseUntil <= now))
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.Status, WorkoutRestAlertStatus.Expired)
                .SetProperty(x => x.LeaseUntil, (DateTime?)null).SetProperty(x => x.UpdatedAt, now), ct);
        await db.WorkoutRestAlertSchedules.IgnoreQueryFilters()
            .Where(x => !ActiveStatuses.Contains(x.Status) && x.CreatedAt < now.AddDays(-30))
            .ExecuteDeleteAsync(ct);

        var pending = await db.WorkoutRestAlertSchedules.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.Status == WorkoutRestAlertStatus.Pending && x.ExpiresAt > now)
            .OrderBy(x => x.Deadline).Take(RecoveryBatchSize).ToListAsync(ct);
        var repaired = 0;
        foreach (var item in pending)
        {
            ct.ThrowIfCancellationRequested();
            if (!await IsStillEligibleForRecovery(item, ct))
            {
                await MarkInactive(item.Id, ct);
                await tasks.DeleteTaskAsync(item.TaskName, ct);
                continue;
            }
            if (!await tasks.EnsureTaskAsync(item, ct)) continue;
            var updated = await db.WorkoutRestAlertSchedules.IgnoreQueryFilters()
                .Where(x => x.Id == item.Id && x.Status == WorkoutRestAlertStatus.Pending && x.ExpiresAt > DateTime.UtcNow)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.Status, WorkoutRestAlertStatus.Scheduled)
                    .SetProperty(x => x.UpdatedAt, DateTime.UtcNow), ct);
            if (updated == 0) await tasks.DeleteTaskAsync(item.TaskName, ct);
            else repaired++;
        }
        return repaired;
    }

    private async Task<bool> ConfirmTaskScheduled(Guid scheduleId, CancellationToken ct)
    {
        db.MaintenanceAccess = true;
        var snapshot = await db.WorkoutRestAlertSchedules.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.Id == scheduleId, ct);
        if (snapshot is null) return false;
        db.CurrentUser = snapshot.UserId;
        await using var gate = await MutationLock.Acquire(db, snapshot.UserId, ct);
        var row = await db.WorkoutRestAlertSchedules.SingleOrDefaultAsync(x => x.Id == scheduleId, ct);
        if (row is null || row.ExpiresAt <= DateTime.UtcNow) return false;
        if (row.Status is WorkoutRestAlertStatus.Scheduled or WorkoutRestAlertStatus.Dispatching or WorkoutRestAlertStatus.Accepted)
        {
            await gate.Commit(ct);
            return true;
        }
        if (row.Status != WorkoutRestAlertStatus.Pending) return false;
        if (!await IsStillEligible(row, ct))
        {
            row.Status = WorkoutRestAlertStatus.Cancelled;
            row.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            return false;
        }
        row.Status = WorkoutRestAlertStatus.Scheduled;
        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return true;
    }

    private async Task<bool> IsStillEligible(WorkoutRestAlertSchedule row, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == row.UserId, ct);
        return user is { RestAlerts: true } &&
            await db.Workouts.AsNoTracking().AnyAsync(x => x.Id == row.SessionId && x.Active && x.PausedAt == null, ct) &&
            await db.WorkoutPushDevices.AnyAsync(x => x.DeviceId == row.DeviceId, ct);
    }

    private async Task<bool> IsStillEligible(WorkoutRestAlertSchedule row, CancellationToken ct, bool ignoreFilters)
    {
        if (!ignoreFilters) return await IsStillEligible(row, ct);
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == row.UserId, ct);
        return user is { RestAlerts: true } &&
            await db.Workouts.IgnoreQueryFilters().AsNoTracking().AnyAsync(x => x.UserId == row.UserId && x.Id == row.SessionId && x.Active && x.PausedAt == null, ct) &&
            await db.WorkoutPushDevices.IgnoreQueryFilters().AnyAsync(x => x.UserId == row.UserId && x.DeviceId == row.DeviceId, ct);
    }

    private async Task<bool> IsStillEligibleForRecovery(WorkoutRestAlertSchedule row, CancellationToken ct)
        => await IsStillEligible(row, ct, ignoreFilters: true);

    private async Task MarkInactive(Guid scheduleId, CancellationToken ct)
    {
        await db.WorkoutRestAlertSchedules.IgnoreQueryFilters()
            .Where(x => x.Id == scheduleId && x.Status == WorkoutRestAlertStatus.Pending)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.Status, WorkoutRestAlertStatus.Cancelled)
                .SetProperty(x => x.UpdatedAt, DateTime.UtcNow), ct);
    }

    private async Task<RestAlertTaskResult> SetExpired(Guid id, CancellationToken ct)
    {
        await db.WorkoutRestAlertSchedules.IgnoreQueryFilters()
            .Where(x => x.Id == id && x.Status == WorkoutRestAlertStatus.Dispatching)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.Status, WorkoutRestAlertStatus.Expired)
                .SetProperty(x => x.UpdatedAt, DateTime.UtcNow).SetProperty(x => x.LeaseUntil, (DateTime?)null), ct);
        return new("expired");
    }

    private async Task<WorkoutPushSendResult> Send(string token, WorkoutPushContent content, CancellationToken ct)
    {
        try { return await push.SendAsync(token, content, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Workout rest-alert provider call failed unexpectedly.");
            return new(WorkoutPushSendStatus.TransientFailure);
        }
    }

    private async Task DeleteTasks(IEnumerable<string> taskNames, CancellationToken ct)
    {
        foreach (var name in taskNames.Distinct(StringComparer.Ordinal))
            await tasks.DeleteTaskAsync(name, ct);
    }

    private static readonly string[] ActiveStatuses = [WorkoutRestAlertStatus.Pending, WorkoutRestAlertStatus.Scheduled, WorkoutRestAlertStatus.Dispatching];

    private static void ValidateDeviceId(string deviceId)
        => Validation.Require(!string.IsNullOrWhiteSpace(deviceId) && deviceId.Length <= 200 &&
            deviceId.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_'), "This device identifier is not valid.", 400);
}

public sealed record RestAlertDeviceStatus(bool Configured, bool Registered, Guid? CurrentGeneration, string Message);
public sealed record RestAlertScheduleInput(string DeviceId, Guid Generation, DateTimeOffset Deadline, Guid? ExpectedGeneration);
public sealed record RestAlertCancelInput(string DeviceId, Guid Generation);
