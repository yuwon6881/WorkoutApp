namespace Workout.Api.Services;

/// Brings free text into the length its column holds.
internal static class ImportNormalization
{
    /// Truncating the tail of an unusually long note is better than failing an import over it.
    public static string? Text(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max].TrimEnd();
    }
}
