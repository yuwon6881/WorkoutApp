using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services.AI;
using Workout.Api.Services.AI.Agent;
using Workout.Api.Services.AI.Tools;
using Xunit;

namespace Workout.Tests;

public sealed class AskAiTests
{
    [Fact]
    public void AiToolArgs_ValidatesAndParsesCorrectly()
    {
        var json = """
        {
            "query": "squat",
            "limit": 10,
            "fromDate": "2026-09-01",
            "ratio": 1.5,
            "tags": ["legs", "heavy"]
        }
        """;
        var args = AiToolArgs.Parse(json);

        Assert.Equal("squat", args.RequiredString("query"));
        Assert.Equal(10, args.OptionalInt("limit", 1, 20));
        Assert.Equal(new DateOnly(2026, 9, 1), args.OptionalDate("fromDate"));
        Assert.Equal(1.5m, args.OptionalDecimal("ratio", 0, 5));
        Assert.Equal(2, args.OptionalStringArray("tags", 5).Count);
    }

    [Fact]
    public void AiToolArgs_ThrowsOnInvalidOrMissingValues()
    {
        var args = AiToolArgs.Parse("{\"limit\": 50}");
        Assert.Throws<AiToolArgumentException>(() => args.OptionalInt("limit", 1, 20));
        Assert.Throws<AiToolArgumentException>(() => args.RequiredString("missing"));
        Assert.Throws<AiToolArgumentException>(() => AiToolArgs.Parse("not-json"));
    }

    [Fact]
    public async Task AiActionProposer_EnforcesEvidenceBarrier()
    {
        var context = new AiToolContext("kg", new DateOnly(2026, 9, 30));
        var validWorkoutId = Guid.NewGuid().ToString();
        var unseenWorkoutId = Guid.NewGuid().ToString();

        // Record only the valid workout in the evidence ledger
        context.Evidence.Record(AiEvidenceLedger.Workout, validWorkoutId);

        var proposer = new AiActionProposer(context);

        // Proposing action for unseen workout must be rejected
        var invalidProposalJson = JsonSerializer.Serialize(new
        {
            actions = new[]
            {
                new { type = "openWorkout", payload = new { workoutId = unseenWorkoutId } }
            }
        });

        var resultJson = await proposer.ProposeAsync(invalidProposalJson, CancellationToken.None);
        var resultNode = JsonNode.Parse(resultJson);
        var firstResult = resultNode?["results"]?[0];

        Assert.False(firstResult?["accepted"]?.GetValue<bool>());
        Assert.Empty(proposer.Accepted);

        // Proposing action for surfaced workout must be accepted
        var validProposalJson = JsonSerializer.Serialize(new
        {
            actions = new[]
            {
                new { type = "openWorkout", payload = new { workoutId = validWorkoutId } }
            }
        });

        var validResultJson = await proposer.ProposeAsync(validProposalJson, CancellationToken.None);
        var validResultNode = JsonNode.Parse(validResultJson);
        var validFirstResult = validResultNode?["results"]?[0];

        Assert.True(validFirstResult?["accepted"]?.GetValue<bool>());
        Assert.Single(proposer.Accepted);
        Assert.Equal("openWorkout", proposer.Accepted[0].Type);
    }

    [Fact]
    public async Task ConversationMemory_CreatesPersistsAndReplaysTurns()
    {
        await using var harness = await Harness.Create();
        var user = await harness.CreateUser();
        harness.Db.CurrentUser = user.Id;

        var memory = new AiConversationMemoryService(harness.Db);

        var clientTurnId = "turn_test_123";
        var request = new AiChatRequest(
            Message: "What exercises did I do yesterday?",
            History: null,
            ClientTurnId: clientTurnId);

        // First attempt prepares turn
        var prepared = await memory.PrepareAsync(request, CancellationToken.None);
        Assert.NotNull(prepared.Conversation);
        Assert.NotNull(prepared.PendingTurn);
        Assert.Equal(clientTurnId, prepared.ClientTurnId);

        // Complete the turn
        var response = new AiChatResponse(
            Reply: "You performed Barbell Squat and Romanian Deadlift.",
            Actions: [new AiUiAction("openWorkout", new Dictionary<string, object?> { ["workoutId"] = Guid.NewGuid().ToString() })]);

        var completed = await memory.CompleteAsync(prepared, request.Message, response, CancellationToken.None);
        Assert.NotNull(completed);
        Assert.Equal(1, completed.ConversationVersion);
        Assert.Single(completed.Actions);

        // Replaying with identical clientTurnId returns completed response without creating new turn
        var replayPrepared = await memory.PrepareAsync(request, CancellationToken.None);
        Assert.NotNull(replayPrepared.Replay);
        Assert.Equal(response.Reply, replayPrepared.Replay.Reply);

        // Retrieve active conversation
        var active = await memory.GetActiveAsync(CancellationToken.None);
        Assert.Equal(completed.ConversationId, active.ConversationId);
        Assert.Equal(2, active.Messages.Count); // 1 user + 1 assistant
        Assert.Equal("user", active.Messages[0].Role);
        Assert.Equal(request.Message, active.Messages[0].Content);
        Assert.Equal("assistant", active.Messages[1].Role);
        Assert.Equal(response.Reply, active.Messages[1].Content);
    }

    [Fact]
    public async Task GetWorkoutHistoryTool_ReturnsWorkoutsAndRecordsEvidence()
    {
        await using var harness = await Harness.Create();
        var user = await harness.CreateUser();
        harness.Db.CurrentUser = user.Id;

        var workout = new WorkoutSession
        {
            UserId = user.Id,
            Name = "Leg Day A",
            Active = false,
            StartedAt = DateTime.UtcNow.AddHours(-2),
            FinishedAt = DateTime.UtcNow.AddHours(-1)
        };
        harness.Db.Workouts.Add(workout);

        var exercise = new SessionExercise
        {
            UserId = user.Id,
            SessionId = workout.Id,
            NameSnapshot = "Barbell Back Squat",
            Position = 0
        };
        harness.Db.SessionExercises.Add(exercise);

        var set = new CompletedSet
        {
            UserId = user.Id,
            SessionExerciseId = exercise.Id,
            Position = 0,
            WeightKg = 100,
            Reps = 5,
            Rpe = 8,
            Done = true
        };
        harness.Db.Sets.Add(set);
        await harness.Db.SaveChangesAsync();

        var tool = new GetWorkoutHistoryTool(harness.Db);
        var context = new AiToolContext("kg", DateOnly.FromDateTime(DateTime.UtcNow));
        var result = await tool.ExecuteAsync(AiToolArgs.Parse("{\"limit\": 5}"), context, CancellationToken.None);

        Assert.NotNull(result.Data);
        Assert.True(context.Evidence.Contains(AiEvidenceLedger.Workout, workout.Id.ToString()));
    }

    [Fact]
    public async Task BaselineSnapshotBuilder_ProducesContext()
    {
        await using var harness = await Harness.Create();
        var user = await harness.CreateUser();
        harness.Db.CurrentUser = user.Id;

        var program = new TrainingProgram
        {
            UserId = user.Id,
            Name = "Hypertrophy Block",
            Active = true,
            Weeks = 8
        };
        harness.Db.Programs.Add(program);
        await harness.Db.SaveChangesAsync();

        var builder = new AiBaselineSnapshotBuilder(harness.Db);
        var context = new AiToolContext("kg", new DateOnly(2026, 9, 30));
        var snapshot = await builder.BuildAsync(context, CancellationToken.None);

        Assert.Equal("2026-09-30", snapshot["today"]?.GetValue<string>());
        Assert.Equal("kg", snapshot["weightUnit"]?.GetValue<string>());
        Assert.NotNull(snapshot["activeProgram"]);
        Assert.Equal("Hypertrophy Block", snapshot["activeProgram"]?["name"]?.GetValue<string>());
    }

    [Fact]
    public async Task ChatUsageMeter_RecordsDailyUsage()
    {
        await using var harness = await Harness.Create();
        var user = await harness.CreateUser();
        harness.Db.CurrentUser = user.Id;

        var meter = new AiChatUsageMeter(harness.Db, NullLogger<AiChatUsageMeter>.Instance);
        var usage = new AiTokenUsage(InputTokens: 500, CachedTokens: 200, OutputTokens: 100, ReasoningTokens: 20);

        await meter.RecordAsync(usage, rounds: 2, CancellationToken.None);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var row = harness.Db.Usage.FirstOrDefault(u => u.UserId == user.Id && u.Date == today);

        Assert.NotNull(row);
        Assert.Equal(500, row.ChatInputTokens);
        Assert.Equal(200, row.ChatCachedTokens);
        Assert.Equal(100, row.ChatOutputTokens);
        Assert.Equal(20, row.ChatReasoningTokens);
        Assert.Equal(1, row.ChatCalls);
    }
}
