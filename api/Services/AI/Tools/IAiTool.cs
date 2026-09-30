using System.Text.Json.Nodes;

namespace Workout.Api.Services.AI.Tools;

// A read-only capability the model may call. Tools never mutate data: every change still goes
// through a proposed UI action that the user confirms.
public interface IAiTool
{
    string Name { get; }
    string Description { get; }
    JsonObject ParametersSchema { get; }

    // Plain-language progress shown while the tool runs ("Looking up your workouts...").
    string ProgressLabel(AiToolArgs args);

    Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken);
}

public sealed record AiToolResult(object? Data, bool Truncated = false, bool Approximate = false)
{
    public static AiToolResult Of(object? data, bool truncated = false, bool approximate = false) =>
        new(data, truncated, approximate);
}

public sealed class AiToolArgumentException(string message) : Exception(message);
