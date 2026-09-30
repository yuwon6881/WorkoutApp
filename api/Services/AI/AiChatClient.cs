using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Workout.Api.Services.AI;

// Direct HTTP client for the OpenAI Responses API, supporting multi-round tool-calling and
// streaming. The existing WorkoutAi handles PDF imports; this serves the Ask AI chat engine.
public sealed class AiChatClient
{
    private const string DefaultModel = "gpt-5.4-mini";
    private const string ResponsesEndpoint = "https://api.openai.com/v1/responses";
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan DefaultResponseTimeout = TimeSpan.FromSeconds(45);

    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AiChatClient> _logger;

    public AiChatClient(HttpClient httpClient, IConfiguration configuration, ILogger<AiChatClient> logger)
    {
        _httpClient = httpClient;
        _configuration = configuration;
        _logger = logger;
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_configuration["OpenAi:ApiKey"]);

    public async Task<AiResponseResult> CreateResponseAsync(
        AiResponseRequest request,
        IAiStreamSink? sink = null,
        CancellationToken cancellationToken = default)
    {
        var apiKey = _configuration["OpenAi:ApiKey"]?.Trim()
            ?? throw new AiChatClientException("AI service is not configured on the server.");
        var model = ResolveModel(request.ModelConfigurationKey);
        var body = BuildRequestBody(request, model, stream: sink != null);

        using var timeout = new CancellationTokenSource(request.Timeout ?? DefaultResponseTimeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        try
        {
            try
            {
                return await SendRoundAsync(model, body, apiKey, request, sink, linked.Token);
            }
            catch (AiProviderUnavailableException) when (!linked.IsCancellationRequested)
            {
                await Task.Delay(RetryDelay, linked.Token);
                return await SendRoundAsync(model, body, apiKey, request, sink, linked.Token);
            }
        }
        catch (AiProviderUnavailableException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AiChatClientException("AI service is temporarily unavailable. Please try again.");
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("AI request {Feature}/{Model} exceeded its deadline.", request.Feature, model);
            throw new AiChatClientException("AI took too long to respond. Please try again.");
        }
    }

    private string ResolveModel(string modelConfigurationKey)
    {
        var model = _configuration[modelConfigurationKey];
        if (string.IsNullOrWhiteSpace(model)) model = _configuration["OpenAi:Model"];
        return string.IsNullOrWhiteSpace(model) ? DefaultModel : model;
    }

    private async Task<AiResponseResult> SendRoundAsync(
        string model, byte[] body, string apiKey,
        AiResponseRequest request, IAiStreamSink? sink, CancellationToken cancellationToken)
    {
        var startedAt = Stopwatch.GetTimestamp();
        using var response = await SendToProviderAsync(model, body, apiKey, request.Feature, cancellationToken);
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);

        AiResponseResult result;
        if (sink == null)
        {
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            result = ParseResult(document.RootElement, model, request.Feature);
        }
        else
        {
            JsonElement final;
            try
            {
                final = await AiResponseStreamReader.ReadAsync(stream, sink, cancellationToken);
            }
            catch (AiStreamProtocolException ex)
            {
                _logger.LogWarning("AI stream failed for {Feature} using {Model}: {Detail}", request.Feature, model, ex.Message);
                throw new AiChatClientException("AI service returned an error. Please try again.");
            }
            catch (Exception ex) when (ex is IOException or HttpRequestException && !cancellationToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "AI stream was interrupted for {Feature} using {Model}.", request.Feature, model);
                throw new AiChatClientException("The AI connection was interrupted. Please try again.");
            }
            result = ParseResult(final, model, request.Feature);
        }

        _logger.LogInformation(
            "AI request {Feature}/{Model} completed in {ElapsedMs:F0} ms with {ToolCalls} tool call(s).",
            request.Feature, model, Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds, result.FunctionCalls.Count);
        return result;
    }

    internal static byte[] BuildRequestBody(AiResponseRequest request, string model, bool stream)
    {
        var body = new JsonObject
        {
            ["model"] = model,
            ["store"] = false,
            ["input"] = new JsonArray(request.Input.Select(item => (JsonNode)item.DeepClone()).ToArray()),
            ["max_output_tokens"] = request.MaxOutputTokens
        };
        if (!string.IsNullOrWhiteSpace(request.Instructions)) body["instructions"] = request.Instructions;
        if (!string.IsNullOrWhiteSpace(request.ReasoningEffort))
        {
            body["reasoning"] = new JsonObject { ["effort"] = request.ReasoningEffort };
            body["include"] = new JsonArray("reasoning.encrypted_content");
        }
        if (request.Tools is { Count: > 0 } tools)
        {
            body["tools"] = new JsonArray(tools.Select(tool => (JsonNode)new JsonObject
            {
                ["type"] = "function",
                ["name"] = tool.Name,
                ["description"] = tool.Description,
                ["parameters"] = tool.Parameters.DeepClone(),
                ["strict"] = tool.Strict
            }).ToArray());
            body["parallel_tool_calls"] = request.ParallelToolCalls;
        }
        if (!string.IsNullOrWhiteSpace(request.ToolChoice))
        {
            body["tool_choice"] = request.ToolChoice is "auto" or "none" or "required"
                ? request.ToolChoice
                : new JsonObject { ["type"] = "function", ["name"] = request.ToolChoice };
        }
        if (!string.IsNullOrWhiteSpace(request.PromptCacheKey)) body["prompt_cache_key"] = request.PromptCacheKey;
        if (stream) body["stream"] = true;
        return JsonSerializer.SerializeToUtf8Bytes(body);
    }

    private async Task<HttpResponseMessage> SendToProviderAsync(
        string model, byte[] body, string apiKey, string feature, CancellationToken cancellationToken)
    {
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, _configuration["OpenAi:BaseUrl"] ?? ResponsesEndpoint);
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        httpRequest.Content = new ByteArrayContent(body);
        httpRequest.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(httpRequest, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "AI provider request failed for {Feature} using {Model}.", feature, model);
            throw new AiChatClientException("AI service is unreachable. Please try again.");
        }

        if (response.IsSuccessStatusCode) return response;

        using (response)
        {
            var errorBody = await SafeReadErrorBodyAsync(response, cancellationToken);
            if (IsTransient(response.StatusCode))
            {
                _logger.LogWarning("AI provider returned transient {Status} for {Feature}/{Model}. Body: {Body}",
                    (int)response.StatusCode, feature, model, errorBody);
                throw new AiProviderUnavailableException();
            }
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                _logger.LogWarning("AI provider rate limit for {Feature}/{Model}.", feature, model);
                throw new AiChatClientException("AI service rate limit reached. Please wait a moment.");
            }
            _logger.LogWarning("AI provider returned {Status} for {Feature}/{Model}. Body: {Body}",
                (int)response.StatusCode, feature, model, errorBody);
            throw new AiChatClientException("AI service returned an error. Please try again.");
        }
    }

    private AiResponseResult ParseResult(JsonElement root, string model, string feature)
    {
        var usage = LogUsage(root, model, feature);
        var status = root.TryGetProperty("status", out var s) ? s.GetString() : null;
        if (status is "failed" or "incomplete")
        {
            _logger.LogWarning("AI response failed for {Feature}/{Model}.", feature, model);
            throw new AiChatClientException("AI could not process this request. Please try again.");
        }
        if (!root.TryGetProperty("output", out var output) || output.ValueKind != JsonValueKind.Array)
            throw new AiChatClientException("AI returned an empty response. Please try again.");

        var items = new List<JsonObject>();
        var calls = new List<AiFunctionCall>();
        var textParts = new List<string>();
        foreach (var item in output.EnumerateArray())
        {
            if (JsonNode.Parse(item.GetRawText()) is JsonObject copy) items.Add(copy);
            var type = item.TryGetProperty("type", out var t) ? t.GetString() : null;
            if (type == "function_call")
            {
                calls.Add(new AiFunctionCall(
                    item.TryGetProperty("call_id", out var cid) ? cid.GetString() ?? "" : "",
                    item.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "",
                    item.TryGetProperty("arguments", out var a) ? a.GetString() ?? "{}" : "{}"));
                continue;
            }
            if (!item.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array) continue;
            foreach (var part in content.EnumerateArray())
            {
                var partType = part.TryGetProperty("type", out var pt) ? pt.GetString() : null;
                if (partType == "output_text" && part.TryGetProperty("text", out var text))
                    textParts.Add(text.GetString() ?? "");
            }
        }

        var joined = string.Concat(textParts).Trim();
        if (calls.Count == 0 && joined.Length == 0)
            throw new AiChatClientException("AI returned an empty response. Please try again.");

        return new AiResponseResult(model, joined, calls, items, usage);
    }

    private AiTokenUsage LogUsage(JsonElement root, string model, string feature)
    {
        if (!root.TryGetProperty("usage", out var usage)) return AiTokenUsage.None;
        var reasoning = usage.TryGetProperty("output_tokens_details", out var od) ? ReadInt(od, "reasoning_tokens") : 0;
        var cached = usage.TryGetProperty("input_tokens_details", out var id) ? ReadInt(id, "cached_tokens") : 0;
        _logger.LogInformation("AI usage {Feature}/{Model}: in={In}, out={Out}, reasoning={R}, cached={C}.",
            feature, model, ReadInt(usage, "input_tokens"), ReadInt(usage, "output_tokens"), reasoning, cached);
        return new AiTokenUsage(ReadInt(usage, "input_tokens"), cached, ReadInt(usage, "output_tokens"), reasoning);
    }

    private static int ReadInt(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.TryGetInt32(out var n) ? n : 0;

    private static bool IsTransient(HttpStatusCode code) =>
        code is HttpStatusCode.InternalServerError or HttpStatusCode.BadGateway or
            HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout;

    private static async Task<string> SafeReadErrorBodyAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try { var b = await response.Content.ReadAsStringAsync(ct); return b.Length <= 2000 ? b : b[..2000] + "..."; }
        catch (Exception ex) { return $"<failed: {ex.Message}>"; }
    }

    private sealed class AiProviderUnavailableException : Exception;
}

public sealed class AiChatClientException(string message) : Exception(message);
