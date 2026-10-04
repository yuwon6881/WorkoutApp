using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Workout.Api.Data;
using Workout.Api.Services.AI;
using Workout.Api.Services.AI.Agent;
using Workout.Api.Services.AI.Tools;
using Xunit;

namespace Workout.Tests;

public sealed class AskAiDeadlineTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Overall_deadline_and_caller_cancellation_preserve_history_and_allow_retry(bool callerCancels)
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var db = harness.Db;
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["OpenAi:ApiKey"] = "test-key" }).Build();
        var clock = new DeadlineClock();
        using var caller = new CancellationTokenSource();
        using var handler = new HangingProvider(() => { if (callerCancels) caller.Cancel(); else clock.Expire(); });
        var client = new AiChatClient(new HttpClient(handler), config, NullLogger<AiChatClient>.Instance);
        var registry = new AiToolRegistry([]);
        var usage = new AiChatUsageMeter(db, NullLogger<AiChatUsageMeter>.Instance);
        var engine = new AiAgentEngine(client, registry, new AiToolExecutor(registry, NullLogger<AiToolExecutor>.Instance), NullLogger<AiAgentEngine>.Instance, usage, config);
        var memory = new AiConversationMemoryService(db);
        var service = new AiAssistantService(client, db, new AiAgentServices(engine, new AiBaselineSnapshotBuilder(db), usage), memory, NullLogger<AiAssistantService>.Instance, clock);
        var greeting = await service.ChatAsync(new AiChatRequest("hi", History: null, ClientTurnId: "greeting"));
        var request = new AiChatRequest("Review my recent progress", History: null, ConversationId: greeting.Response.ConversationId,
            ConversationVersion: greeting.Response.ConversationVersion, ClientTurnId: "retryable");
        if (callerCancels) await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.ChatAsync(request, caller.Token));
        else
        {
            var result = await service.ChatAsync(request);
            Assert.True(result.IsProviderError);
            Assert.Contains("retained", result.Response.Reply);
            Assert.Equal(greeting.Response.ConversationId, result.Response.ConversationId);
        }
        Assert.Equal(TimeSpan.FromSeconds(150), clock.DueTime);
        Assert.False(await db.AiConversationTurns.AnyAsync(t => t.Status == "Pending"));
        var history = await memory.GetActiveAsync(default);
        Assert.Equal(2, history.Messages.Count);
        var retry = await memory.PrepareAsync(request, default);
        Assert.False(retry.Conflict);
        Assert.NotNull(retry.PendingTurn);
    }

    private sealed class HangingProvider(Action cancel) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            cancel();
            await Task.Delay(Timeout.Infinite, ct);
            throw new InvalidOperationException("The canceled provider must never complete.");
        }
    }
    private sealed class DeadlineClock : TimeProvider
    {
        private TimerCallback? callback;
        private object? state;
        public TimeSpan DueTime { get; private set; }
        public void Expire() => callback!(state);
        public override ITimer CreateTimer(TimerCallback timerCallback, object? timerState, TimeSpan dueTime, TimeSpan period)
        { callback = timerCallback; state = timerState; DueTime = dueTime; return new ManualTimer(); }
        private sealed class ManualTimer : ITimer
        {
            public bool Change(TimeSpan dueTime, TimeSpan period) => true;
            public void Dispose() { }
            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }
}
