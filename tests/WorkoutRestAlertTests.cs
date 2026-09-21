using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Configuration;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services.RestAlerts;
using Xunit;

namespace Workout.Tests;

public sealed class WorkoutRestAlertTests
{
    [Fact]
    public async Task Subscription_is_account_scoped_and_schedule_intent_recovers_after_queue_failure()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        var session = await h.Workouts.Start(null, "Leg day", default);
        var queue = new FakeTaskQueue { NextResult = false };
        var service = Create(h.Db, queue, new FakePushSender());

        var registered = await service.Register("phone-a", "fcm-token-a", default);
        Assert.True(registered.Registered);
        var otherUser = await h.CreateUser("bob");
        h.Db.ChangeTracker.Clear();
        h.Db.CurrentUser = otherUser.Id;
        Assert.False((await service.Status("phone-a", null, default)).Registered);
        await service.Unregister("phone-a", default);
        h.Db.ChangeTracker.Clear();
        h.Db.CurrentUser = user.Id;
        Assert.True((await service.Status("phone-a", null, default)).Registered);
        var generation = Guid.NewGuid();
        var result = await service.Schedule(session.Id,
            new("phone-a", generation, DateTimeOffset.UtcNow.AddSeconds(15), null), default);

        Assert.False(result.Scheduled);
        var pending = await h.Db.WorkoutRestAlertSchedules.SingleAsync();
        Assert.Equal(WorkoutRestAlertStatus.Pending, pending.Status);
        Assert.Equal(queue.TaskName(pending.Id), pending.TaskName);

        queue.NextResult = true;
        Assert.Equal(1, await service.Recover(default));
        Assert.Equal(WorkoutRestAlertStatus.Scheduled, await h.Db.WorkoutRestAlertSchedules.AsNoTracking().Select(x => x.Status).SingleAsync());
    }

    [Fact]
    public async Task Recovery_enqueues_pending_intent_after_deadline_while_still_within_expiry()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var session = await h.Workouts.Start(null, "Leg day", default);
        var queue = new FakeTaskQueue { NextResult = false };
        var service = Create(h.Db, queue, new FakePushSender());
        await service.Register("phone-a", "fcm-token-a", default);
        var generation = Guid.NewGuid();
        await service.Schedule(session.Id,
            new("phone-a", generation, DateTimeOffset.UtcNow.AddSeconds(20), null), default);
        var schedule = await h.Db.WorkoutRestAlertSchedules.SingleAsync();
        schedule.Deadline = DateTime.UtcNow.AddSeconds(-10);
        schedule.ExpiresAt = DateTime.UtcNow.AddSeconds(45);
        await h.Db.SaveChangesAsync();

        queue.NextResult = true;

        Assert.Equal(1, await service.Recover(default));
        Assert.Equal(WorkoutRestAlertStatus.Scheduled,
            await h.Db.WorkoutRestAlertSchedules.AsNoTracking().Select(x => x.Status).SingleAsync());
        Assert.Contains(schedule.TaskName, queue.Created);
    }

    [Fact]
    public async Task New_generation_cancels_prior_task_and_stale_request_cannot_replace_it()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var session = await h.Workouts.Start(null, "Leg day", default);
        var queue = new FakeTaskQueue();
        var service = Create(h.Db, queue, new FakePushSender());
        await service.Register("phone-a", "fcm-token-a", default);
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await service.Schedule(session.Id, new("phone-a", first, DateTimeOffset.UtcNow.AddSeconds(30), null), default);
        await service.Schedule(session.Id, new("phone-a", second, DateTimeOffset.UtcNow.AddSeconds(45), first), default);

        var rows = await h.Db.WorkoutRestAlertSchedules.OrderBy(x => x.CreatedAt).ToListAsync();
        Assert.Equal(WorkoutRestAlertStatus.Cancelled, rows[0].Status);
        Assert.Equal(WorkoutRestAlertStatus.Scheduled, rows[1].Status);
        Assert.Contains(rows[0].TaskName, queue.Deleted);
        await Assert.ThrowsAsync<DomainException>(() => service.Schedule(session.Id,
            new("phone-a", first, DateTimeOffset.UtcNow.AddSeconds(30), null), default));
        Assert.Equal(2, queue.Created.Count);
    }

    [Fact]
    public async Task Dispatch_rechecks_current_session_and_sends_only_generic_short_lived_content()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var session = await h.Workouts.Start(null, "Private workout title", default);
        var queue = new FakeTaskQueue();
        var push = new FakePushSender();
        var service = Create(h.Db, queue, push);
        await service.Register("phone-a", "secret-fcm-token", default);
        var generation = Guid.NewGuid();
        await service.Schedule(session.Id,
            new("phone-a", generation, DateTimeOffset.UtcNow.AddSeconds(20), null), default);
        var schedule = await h.Db.WorkoutRestAlertSchedules.SingleAsync();
        // Cloud Tasks can be delayed; ExpiresAt, not a fixed deadline grace, is authoritative.
        schedule.Deadline = DateTime.UtcNow.AddSeconds(-7);
        schedule.ExpiresAt = DateTime.UtcNow.AddSeconds(50);
        await h.Db.SaveChangesAsync();

        var result = await service.Dispatch(schedule.Id, default);

        Assert.Equal("complete", result.Status);
        Assert.Equal(1, push.Calls);
        Assert.Equal("Rest timer", push.Content!.Title);
        Assert.Equal("Your rest is over. Open Workout to continue.", push.Content.Body);
        Assert.DoesNotContain("Private workout title", push.Content.Body, StringComparison.Ordinal);
        Assert.Equal($"/?workout={session.Id}", push.Content.Route);
        Assert.InRange(push.Content.TimeToLive, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(2));
        Assert.Equal(WorkoutRestAlertStatus.Accepted, (await h.Db.WorkoutRestAlertSchedules.SingleAsync()).Status);
        Assert.NotNull((await h.Db.WorkoutRestAlertSchedules.SingleAsync()).AcceptedAt);
    }

    [Fact]
    public async Task Dispatch_does_not_send_after_session_pause_or_preference_revocation()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        var session = await h.Workouts.Start(null, "Leg day", default);
        var queue = new FakeTaskQueue();
        var push = new FakePushSender();
        var service = Create(h.Db, queue, push);
        await service.Register("phone-a", "fcm-token-a", default);
        var generation = Guid.NewGuid();
        await service.Schedule(session.Id, new("phone-a", generation, DateTimeOffset.UtcNow.AddSeconds(20), null), default);
        var schedule = await h.Db.WorkoutRestAlertSchedules.SingleAsync();
        schedule.Deadline = DateTime.UtcNow.AddSeconds(-1);
        schedule.ExpiresAt = DateTime.UtcNow.AddSeconds(50);
        h.Db.Users.Single(x => x.Id == user.Id).RestAlerts = false;
        await h.Db.SaveChangesAsync();

        var result = await service.Dispatch(schedule.Id, default);

        Assert.Equal("obsolete", result.Status);
        Assert.Equal(0, push.Calls);
        Assert.Equal(WorkoutRestAlertStatus.Disabled, (await h.Db.WorkoutRestAlertSchedules.SingleAsync()).Status);
    }

    [Fact]
    public async Task Cloud_task_request_uses_stable_identity_schedule_time_and_allowlisted_oidc_target()
    {
        using var handler = new CaptureHandler(HttpStatusCode.Conflict);
        using var http = new HttpClient(handler);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["CloudTasks:ProjectId"] = "project-test",
            ["CloudTasks:Location"] = "asia-southeast1",
            ["CloudTasks:Queue"] = "workout-rest-alerts",
            ["CloudTasks:TargetUrl"] = "https://workout-api.example.run.app/internal/rest-alerts/dispatch",
            ["CloudTasks:CallerServiceAccountEmail"] = "workout-rest-task@example.iam.gserviceaccount.com",
            ["CloudTasks:Audience"] = "https://workout-api.example.run.app"
        }).Build();
        var queue = new CloudTasksRestAlertQueue(http, config, new FakeGoogleTokenProvider(), NullLogger<CloudTasksRestAlertQueue>.Instance);
        var schedule = new WorkoutRestAlertSchedule { Id = Guid.NewGuid(), Deadline = DateTime.UtcNow.AddSeconds(90) };

        Assert.True(queue.Configured);
        Assert.True(await queue.EnsureTaskAsync(schedule, default)); // Existing deterministic task is idempotent.
        Assert.Equal(queue.TaskName(schedule.Id), handler.Body!.RootElement.GetProperty("name").GetString());
        var task = handler.Body.RootElement.GetProperty("httpRequest");
        Assert.Equal("POST", task.GetProperty("httpMethod").GetString());
        Assert.Equal(config["CloudTasks:TargetUrl"], task.GetProperty("url").GetString());
        var oidc = task.GetProperty("oidcToken");
        Assert.Equal(config["CloudTasks:CallerServiceAccountEmail"], oidc.GetProperty("serviceAccountEmail").GetString());
        Assert.Equal(config["CloudTasks:Audience"], oidc.GetProperty("audience").GetString());
        var body = Encoding.UTF8.GetString(Convert.FromBase64String(task.GetProperty("body").GetString()!));
        Assert.Contains(schedule.Id.ToString(), body, StringComparison.OrdinalIgnoreCase);
        Assert.StartsWith("Bearer fake-access-token", handler.Authorization);
    }

    [Fact]
    public async Task Fcm_payload_is_data_only_private_and_uses_remaining_ttl()
    {
        using var handler = new CaptureHandler(HttpStatusCode.OK);
        using var http = new HttpClient(handler);
        var sender = new WorkoutFcmPushSender(http, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Fcm:ProjectId"] = "firebase-project" }).Build(), new FakeGoogleTokenProvider(), NullLogger<WorkoutFcmPushSender>.Instance);
        var content = new WorkoutPushContent("Rest timer", "Your rest is over. Open Workout to continue.",
            "workout-rest-session", "/?workout=abc", TimeSpan.FromSeconds(44), "session-id", "generation-id");

        var result = await sender.SendAsync("fcm-token", content, default);

        Assert.Equal(WorkoutPushSendStatus.Accepted, result.Status);
        var request = handler.Body!.RootElement.GetProperty("message");
        Assert.False(request.TryGetProperty("notification", out _));
        Assert.Equal("44", request.GetProperty("webpush").GetProperty("headers").GetProperty("TTL").GetString());
        var data = request.GetProperty("data");
        Assert.Equal("workout-rest", data.GetProperty("kind").GetString());
        Assert.Equal("Rest timer", data.GetProperty("title").GetString());
        Assert.Equal(content.Route, data.GetProperty("route").GetString());
        Assert.Equal(content.SessionId, data.GetProperty("sessionId").GetString());
        Assert.Equal(content.Generation, data.GetProperty("generation").GetString());
        Assert.False(WorkoutFcmPushSender.IsInvalidOrUnregistered("{\"error\":{\"status\":\"UNREGISTERED\"}}"));
        Assert.True(WorkoutFcmPushSender.IsInvalidOrUnregistered("""{"error":{"details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}"""));
    }

    [Fact]
    public async Task Internal_task_auth_fails_closed_without_configured_bearer_identity()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["CloudTasks:Audience"] = "https://workout-api.example.run.app",
            ["CloudTasks:CallerServiceAccountEmail"] = "workout-rest-task@example.iam.gserviceaccount.com"
        }).Build();
        var validator = new GoogleCloudTaskTokenValidator(config, NullLogger<GoogleCloudTaskTokenValidator>.Instance);

        Assert.False(await validator.IsTrustedAsync(null, default));
        Assert.False(await validator.IsTrustedAsync("Basic anything", default));
        Assert.False(await validator.IsTrustedAsync("Bearer too-short", default));
    }

    private static WorkoutRestAlertService Create(AppDb db, FakeTaskQueue queue, FakePushSender push)
        => new(db, queue, push, NullLogger<WorkoutRestAlertService>.Instance);

    private sealed class FakeTaskQueue : IWorkoutRestTaskQueue
    {
        public bool Configured => true;
        public bool NextResult { get; set; } = true;
        public List<string> Created { get; } = [];
        public List<string> Deleted { get; } = [];
        public string TaskName(Guid id) => $"projects/test/locations/test/queues/rest/tasks/rest-{id:N}";
        public Task<bool> EnsureTaskAsync(WorkoutRestAlertSchedule schedule, CancellationToken ct)
        { Created.Add(schedule.TaskName); return Task.FromResult(NextResult); }
        public Task<bool> DeleteTaskAsync(string taskName, CancellationToken ct)
        { Deleted.Add(taskName); return Task.FromResult(true); }
    }

    private sealed class FakePushSender : IWorkoutPushSender
    {
        public bool Configured => true;
        public int Calls { get; private set; }
        public WorkoutPushContent? Content { get; private set; }
        public WorkoutPushSendStatus Result { get; set; } = WorkoutPushSendStatus.Accepted;
        public Task<WorkoutPushSendResult> SendAsync(string token, WorkoutPushContent content, CancellationToken ct)
        { Calls++; Content = content; return Task.FromResult(new WorkoutPushSendResult(Result)); }
    }

    private sealed class FakeGoogleTokenProvider : IGoogleAccessTokenProvider
    {
        public Task<string> GetAccessTokenAsync(string scope, CancellationToken ct) => Task.FromResult("fake-access-token");
    }

    private sealed class CaptureHandler(HttpStatusCode status) : HttpMessageHandler
    {
        public JsonDocument? Body { get; private set; }
        public string? Authorization { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Authorization = request.Headers.Authorization?.ToString();
            if (request.Content is not null)
                Body = JsonDocument.Parse(await request.Content.ReadAsStringAsync(ct));
            return new HttpResponseMessage(status);
        }
        protected override void Dispose(bool disposing) { if (disposing) Body?.Dispose(); base.Dispose(disposing); }
    }
}
