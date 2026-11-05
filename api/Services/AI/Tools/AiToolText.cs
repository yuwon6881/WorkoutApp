namespace Workout.Api.Services.AI.Tools;

/// Free text the user wrote, bounded for a tool result. An empty note stays absent rather than "".
internal static class AiToolText
{
    public static string? Note(string? text, int maxLength)
    {
        var trimmed = text?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return trimmed.Length <= maxLength ? trimmed : trimmed[..(maxLength - 1)].TrimEnd() + "…";
    }
}
