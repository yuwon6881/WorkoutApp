using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Workout.Api.Data;
using Workout.Api.Services.AI;
using Workout.Api.Services.AI.Agent;
using Workout.Api.Services.AI.Tools;
using Xunit;

namespace Workout.Tests;

public sealed class AskAiReviewTests
{
    [Fact]
    public async Task CatalogIncludesOwnedCustomExercisesAndProgressResolvesTheirSlug()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var db = harness.Db;
        var exercise = new CustomExercise { UserId = db.CurrentUser!.Value,
            Name = "My cable press", Muscle = "Chest", Equipment = "Cable", Category = "Machine" };
        db.CustomExercises.Add(exercise);
        await db.SaveChangesAsync();
        var context = new AiToolContext("kg", new DateOnly(2026, 9, 30));
        var result = await new GetExerciseCatalogTool(db).ExecuteAsync(
            AiToolArgs.Parse("{\"query\":\"cable\",\"category\":\"Machine\"}"), context, default);
        var row = JsonSerializer.SerializeToElement(result.Data).GetProperty("exercises")[0];
        Assert.True(row.GetProperty("isCustom").GetBoolean());
        var slug = row.GetProperty("slug").GetString()!;
        Assert.True(context.Evidence.Contains(AiEvidenceLedger.Exercise, slug));
        var progress = await new GetExerciseProgressTool(db).ExecuteAsync(
            AiToolArgs.Parse(JsonSerializer.Serialize(new { exercise = slug })), context, default);
        Assert.Equal(exercise.Name, JsonSerializer.SerializeToElement(progress.Data).GetProperty("exercise").GetString());
    }

    [Fact]
    public async Task CompactBaselineCannotAuthorizeOmittedTemplateIds()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var db = harness.Db;
        var program = new TrainingProgram { UserId = db.CurrentUser!.Value, Name = "My program", Active = true };
        var template = new WorkoutTemplate { UserId = db.CurrentUser.Value, ProgramId = program.Id, Name = "My day" };
        db.Programs.Add(program);
        db.Templates.Add(template);
        await db.SaveChangesAsync();
        var context = new AiToolContext("kg", new DateOnly(2026, 9, 30));
        var baseline = await new AiBaselineSnapshotBuilder(db).BuildAsync(context, default);
        Assert.Equal(program.Id.ToString(), baseline["activeProgram"]?["id"]?.GetValue<string>());
        Assert.True(context.Evidence.Contains(AiEvidenceLedger.Program, program.Id.ToString()));
        Assert.False(context.Evidence.Contains(AiEvidenceLedger.Template, template.Id.ToString()));
    }

    [Fact]
    public async Task SchedulerPrunesExpiredAndAbandonedTurns()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var db = harness.Db;
        var conversation = new AiConversation { UserId = db.CurrentUser!.Value };
        db.AiConversations.Add(conversation);
        db.AiConversationTurns.AddRange(
            new AiConversationTurn { UserId = db.CurrentUser.Value, ConversationId = conversation.Id, ClientTurnId = "old",
                CreatedAt = DateTime.UtcNow.AddDays(-100), Status = "Completed" },
            new AiConversationTurn { UserId = db.CurrentUser.Value, ConversationId = conversation.Id, ClientTurnId = "stuck",
                CreatedAt = DateTime.UtcNow.AddMinutes(-11), Status = "Pending" },
            new AiConversationTurn { UserId = db.CurrentUser.Value, ConversationId = conversation.Id, ClientTurnId = "recent",
                CreatedAt = DateTime.UtcNow.AddDays(-1), Status = "Completed" });
        await db.SaveChangesAsync();
        await harness.Imports(new NoProvider()).CleanupExpired(default);
        var remaining = await db.AiConversationTurns.AsNoTracking().SingleAsync();
        Assert.Equal("recent", remaining.ClientTurnId);
    }

    private sealed class NoProvider : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            throw new InvalidOperationException("Cleanup must not call the provider.");
    }

    [Fact]
    public async Task HistoryUsesLocalCompletionDatesAndPreservesTimedSets()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var db = harness.Db;
        var workout = new WorkoutSession { UserId = db.CurrentUser!.Value, Name = "Late training", Active = false,
            StartedAt = new DateTime(2026, 9, 29, 15, 30, 0, DateTimeKind.Utc),
            FinishedAt = new DateTime(2026, 9, 29, 16, 30, 0, DateTimeKind.Utc) };
        var exercise = new SessionExercise { UserId = db.CurrentUser.Value, SessionId = workout.Id,
            NameSnapshot = "Plank" };
        db.Workouts.Add(workout);
        db.Workouts.Add(new WorkoutSession { UserId = db.CurrentUser.Value, Name = "Finished earlier", Active = false,
            StartedAt = new DateTime(2026, 9, 29, 16, 15, 0, DateTimeKind.Utc),
            FinishedAt = new DateTime(2026, 9, 29, 16, 25, 0, DateTimeKind.Utc) });
        db.SessionExercises.Add(exercise);
        db.Sets.Add(new CompletedSet { UserId = db.CurrentUser.Value, SessionExerciseId = exercise.Id, Done = true,
            DurationSeconds = 60, Rir = "2", Rpe = 8 });
        await db.SaveChangesAsync();
        var context = new AiToolContext("kg", new DateOnly(2026, 9, 30), timeZone: "Asia/Kuala_Lumpur", trackRir: false);
        var result = await new GetWorkoutHistoryTool(db).ExecuteAsync(
            AiToolArgs.Parse("{\"fromDate\":\"2026-09-30\",\"toDate\":\"2026-09-30\"}"), context, default);
        var row = JsonSerializer.SerializeToElement(result.Data).GetProperty("workouts")[0];
        Assert.Equal("Late training", row.GetProperty("name").GetString());
        Assert.Equal("2026-09-30", row.GetProperty("date").GetString());
        var topSet = row.GetProperty("exercises")[0].GetProperty("topSet");
        Assert.Equal(60, topSet.GetProperty("durationSeconds").GetInt32());
        Assert.Equal(JsonValueKind.Null, topSet.GetProperty("rir").ValueKind);
    }


    

    [Theory]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{\"actions\":[null]}")]
    [InlineData("{\"actions\":[{\"type\":123,\"payload\":{}}]}")]
    [InlineData("{\"actions\":[{\"type\":\"openHistory\",\"payload\":[] }]}")]
    public async Task MalformedProposalsAreRejectedWithoutThrowing(string arguments)
    {
        var proposer = new AiActionProposer(new AiToolContext("kg", new DateOnly(2026, 9, 30)));
        await proposer.ProposeAsync(arguments, CancellationToken.None);
        Assert.Empty(proposer.Accepted);
    }

    [Fact]
    public async Task StaleTurnCannotOverwriteCompletedConversation()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var db = harness.Db;
        var firstMemory = new AiConversationMemoryService(db);
        var request = new AiChatRequest("Show my recent history", null, ClientTurnId: "first");
        var first = await firstMemory.PrepareAsync(request, CancellationToken.None);
        await using var other = new AppDb(new DbContextOptionsBuilder<AppDb>()
            .UseSqlite(db.Database.GetDbConnection()).Options) { CurrentUser = db.CurrentUser };
        var otherMemory = new AiConversationMemoryService(other);
        var second = await otherMemory.PrepareAsync(request with { ClientTurnId = "second" }, CancellationToken.None);
        Assert.NotNull(await firstMemory.CompleteAsync(first, request.Message, new AiChatResponse("winner", []), CancellationToken.None));
        Assert.Null(await otherMemory.CompleteAsync(second, request.Message, new AiChatResponse("stale", []), CancellationToken.None));
        other.ChangeTracker.Clear();
        var snapshot = await otherMemory.GetActiveAsync();
        Assert.Equal(1, snapshot.ConversationVersion);
        Assert.Equal("winner", snapshot.Messages.Last().Content);
    }

    [Fact]
    public async Task UsageUpdatesDoNotLosePendingConversationTracking()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var db = harness.Db;
        var memory = new AiConversationMemoryService(db);
        var request = new AiChatRequest("Show my recent history", null, ClientTurnId: "pending");
        var prepared = await memory.PrepareAsync(request, CancellationToken.None);
        var meter = new AiChatUsageMeter(db, NullLogger<AiChatUsageMeter>.Instance);
        await meter.RecordAsync(new AiTokenUsage(500, 200, 100, 20), 2, CancellationToken.None);
        await meter.RecordAsync(new AiTokenUsage(300, 100, 50, 10), 1, CancellationToken.None);
        Assert.NotNull(await memory.CompleteAsync(prepared, request.Message, new AiChatResponse("done", []), CancellationToken.None));
        db.ChangeTracker.Clear();
        var usage = await db.Usage.SingleAsync();
        Assert.Equal(800, usage.ChatInputTokens);
        Assert.Equal(150, usage.ChatOutputTokens);
        Assert.Equal(2, usage.ChatCalls);
        Assert.False(await meter.HasBudgetAsync(950, CancellationToken.None));
        Assert.True(await meter.HasBudgetAsync(951, CancellationToken.None));
    }

    [Fact]
    public async Task OversizedResultDoesNotGrantEvidenceForHiddenRecords()
    {
        var context = new AiToolContext("kg", new DateOnly(2026, 9, 30), new AiTurnBudget(maxCharactersPerResult: 100));
        var registry = new AiToolRegistry([new OversizedTool()]);
        var executor = new AiToolExecutor(registry, NullLogger<AiToolExecutor>.Instance);
        var result = await executor.ExecuteAsync(new AiFunctionCall("call", "oversized", "{}"), context, CancellationToken.None);
        Assert.False(result.Succeeded);
        Assert.False(context.Evidence.Contains("record", "hidden"));
    }

    private sealed class OversizedTool : IAiTool
    {
        public string Name => "oversized";
        public string Description => "Test";
        public System.Text.Json.Nodes.JsonObject ParametersSchema => new() { ["type"] = "object" };
        public string ProgressLabel(AiToolArgs args) => "Checking";
        public Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken ct)
        {
            context.Evidence.Record("record", "hidden");
            return Task.FromResult(AiToolResult.Of(new { text = new string('x', 1000) }));
        }
    }
}
