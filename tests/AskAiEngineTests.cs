using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Workout.Api.Data;
using Workout.Api.Services.AI;
using Workout.Api.Services.AI.Agent;
using Workout.Api.Services.AI.Tools;
using Xunit;

namespace Workout.Tests;

public sealed class AskAiEngineTests
{
    
    private static AiAgentEngine Engine(AppDb db, HttpMessageHandler handler, long budget = 100000)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            { ["OpenAi:ApiKey"] = "test-key", ["Ai:ChatDailyTokenLimit"] = budget.ToString() }).Build();
        var client = new AiChatClient(new HttpClient(handler), config, NullLogger<AiChatClient>.Instance);
        var registry = new AiToolRegistry([new Lookup()]);
        return new AiAgentEngine(client, registry, new AiToolExecutor(registry, NullLogger<AiToolExecutor>.Instance),
            NullLogger<AiAgentEngine>.Instance, new AiChatUsageMeter(db, NullLogger<AiChatUsageMeter>.Instance), config);
    }

    private static AiAgentTurnRequest Request()
    {
        var context = new AiToolContext("kg", new DateOnly(2026, 9, 30));
        return new AiAgentTurnRequest("Show my recent history", [], context, new AiActionProposer(context));
    }

    [Fact]
    public async Task LoopStopsAfterFourToolRoundsAndAccountsForEveryResponse()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var db = harness.Db;
        var bodies = new List<JsonElement>();
        using var handler = new Provider(async request =>
        {
            var body = JsonSerializer.Deserialize<JsonElement>(await request.Content!.ReadAsStringAsync());
            bodies.Add(body);
            return Response(body.GetProperty("tool_choice").GetString() == "none" ? "Finished" : null);
        });
        var result = await Engine(db, handler).RunAsync(Request(), default);
        Assert.Equal(5, result.Rounds);
        Assert.True(result.HitToolLimit);
        Assert.Equal("none", bodies.Last().GetProperty("tool_choice").GetString());
        var usage = await db.Usage.AsNoTracking().SingleAsync();
        Assert.Equal(500, usage.ChatInputTokens);
        Assert.Equal(5, usage.ChatCalls);
        Assert.All(bodies, body => Assert.False(body.GetProperty("store").GetBoolean()));
        Assert.Contains("reasoning.encrypted_content", bodies.Last().GetProperty("include").EnumerateArray().Select(x => x.GetString()));
    }

    [Fact]
    public async Task LaterProviderFailureDoesNotEraseSuccessfulRoundUsage()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var db = harness.Db;
        var calls = 0;
        using var handler = new Provider(_ => Task.FromResult(++calls == 1 ? Response(null)
            : new HttpResponseMessage(HttpStatusCode.BadRequest) { Content = new StringContent("{}") }));
        await Assert.ThrowsAsync<AiChatClientException>(() => Engine(db, handler).RunAsync(Request(), default));
        var usage = await db.Usage.AsNoTracking().SingleAsync();
        Assert.Equal(100, usage.ChatInputTokens);
        Assert.Equal(1, usage.ChatCalls);
    }

    [Fact]
    public async Task ExhaustedDailyBudgetPreventsProviderCall()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var db = harness.Db;
        await new AiChatUsageMeter(db, NullLogger<AiChatUsageMeter>.Instance)
            .RecordAsync(new AiTokenUsage(100, 0, 10, 0), 1, default);
        using var handler = new Provider(_ => throw new InvalidOperationException("Provider must not be called."));
        var exception = await Assert.ThrowsAsync<AiChatClientException>(() => Engine(db, handler, 110).RunAsync(Request(), default));
        Assert.Contains("allowance", exception.Message);
    }

    private static HttpResponseMessage Response(string? text)
    {
        object[] output = text == null
            ? [new { type = "function_call", call_id = Guid.NewGuid().ToString(), name = "test_lookup", arguments = "{}" }]
            : [new { type = "message", role = "assistant", content = new[] { new { type = "output_text", text } } }];
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            { status = "completed", output, usage = new { input_tokens = 100, output_tokens = 10 } }), Encoding.UTF8, "application/json")
        };
    }

    private sealed class Provider(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => respond(request);
    }

    private sealed class Lookup : IAiTool
    {
        public string Name => "test_lookup";
        public string Description => "Read-only test lookup";
        public JsonObject ParametersSchema => new() { ["type"] = "object", ["properties"] = new JsonObject() };
        public string ProgressLabel(AiToolArgs args) => "Checking";
        public Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken ct)
            => Task.FromResult(AiToolResult.Of(new { count = 1 }));
    }
}
