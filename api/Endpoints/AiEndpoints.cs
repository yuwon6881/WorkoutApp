using Microsoft.AspNetCore.Mvc;
using Workout.Api.Services.AI;

namespace Workout.Api.Endpoints;

public sealed record ResolveAiActionBatchRequest(string Resolution);

public static class AiEndpoints
{
    public static void MapAi(this WebApplication app)
    {
        var group = app.MapGroup("/api/ai").RequireRateLimiting("ai-chat");

        group.MapPost("/chat", async (
            [FromBody] AiChatRequest request,
            AiAssistantService assistant,
            CancellationToken ct) =>
        {
            try
            {
                var outcome = await assistant.ChatAsync(request, ct);
                if (outcome.IsConflict)
                    return Results.Conflict(outcome.Response);
                if (outcome.IsProviderError)
                    return Results.Json(outcome.Response, statusCode: StatusCodes.Status503ServiceUnavailable);
                return Results.Ok(outcome.Response);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return Results.StatusCode(499);
            }
            catch (Exception)
            {
                return Results.Json(new { reply = "AI is currently unavailable. Please try again.", actions = Array.Empty<object>() },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });

        group.MapPost("/chat/stream", async (
            [FromBody] AiChatRequest request,
            HttpContext http,
            AiAssistantService assistant,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var logger = loggerFactory.CreateLogger("AiEndpoints");
            await using var events = await AiServerSentEvents.StartAsync(http.Response, ct);
            try
            {
                var outcome = await assistant.ChatAsync(request, events, ct);
                if (outcome.IsConflict)
                    await events.ErrorAsync(StatusCodes.Status409Conflict, outcome.Response, ct);
                else if (outcome.IsProviderError)
                    await events.ErrorAsync(StatusCodes.Status503ServiceUnavailable, outcome.Response, ct);
                else
                    await events.DoneAsync(outcome.Response, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Client aborted turn.
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error while streaming AI turn.");
                await events.ErrorAsync(StatusCodes.Status503ServiceUnavailable,
                    new { reply = "AI is currently unavailable. Please try again.", actions = Array.Empty<object>() },
                    CancellationToken.None);
            }
        });

        group.MapGet("/conversation", async (
            AiConversationMemoryService memory,
            CancellationToken ct) =>
        {
            return Results.Ok(await memory.GetActiveAsync(ct));
        });

        group.MapDelete("/conversation", async (
            [FromQuery] Guid? conversationId,
            [FromQuery] int? expectedVersion,
            AiConversationMemoryService memory,
            CancellationToken ct) =>
        {
            var success = await memory.DeleteActiveAsync(conversationId, expectedVersion, ct);
            return success
                ? Results.NoContent()
                : Results.Conflict(new { message = "This conversation changed on another device. Refresh before resetting." });
        });

        group.MapPost("/action-batches/{batchId:guid}/resolve", async (
            Guid batchId,
            [FromBody] ResolveAiActionBatchRequest request,
            AiConversationMemoryService memory,
            CancellationToken ct) =>
        {
            var dismissed = string.Equals(request.Resolution, "dismissed", StringComparison.OrdinalIgnoreCase);
            if (!dismissed && !string.Equals(request.Resolution, "accepted", StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { message = "Resolution must be 'accepted' or 'dismissed'." });

            var success = await memory.ResolveActionBatchAsync(batchId, dismissed, ct);
            return success ? Results.NoContent() : Results.NotFound();
        });
    }
}
