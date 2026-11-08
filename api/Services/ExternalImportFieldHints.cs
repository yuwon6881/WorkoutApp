using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// What a field must look like, used when a value in the uploaded file has the wrong JSON type. The JSON
/// reader only knows that a value could not be read; the person fixing the file needs to know what that
/// field should hold, in words the assistant that wrote it can act on.
internal static class ExternalImportFieldHints
{
    private static readonly Dictionary<string, string> Hints = Build();

    private const string Fallback = "Use the JSON field type required by the prompt, such as text, number, true or false, list, or object.";

    private static Dictionary<string, string> Build()
    {
        var hints = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["demoLinks"] = "demoLinks maps a name to a link, like {\"Dumbbell press\":\"https://youtu.be/abc\"}, with every link written as text. Leave it out if there are no links.",
            ["demoUrl"] = "demoUrl is one link written as text, like \"https://youtu.be/abc\". Leave it out if there is no link.",
            ["substitutions"] = "substitutions must be a list of names written as text, like [\"Dumbbell press\"].",
            ["targetRpe"] = "targetRpe must be a number such as 8 or 8.5, not text.",
            ["uncertainty"] = "uncertainty must be an object like {\"flag\":true,\"reason\":\"Short plain explanation\"}.",
            ["sourceReference"] = "sourceReference must be an object such as {\"kind\":\"pdfPage\",\"page\":2}.",
        };
        foreach (var name in new[] { "days", "exercises", "sets", "members", "dayKeys", "alternativeGroups" })
            hints[name] = $"{name} must be a list, like [ ... ].";
        foreach (var name in new[] { "repMin", "repMax", "restSeconds", "week", "phaseWeek", "sourceWeekDays" })
            hints[name] = $"{name} must be a whole number such as 8, written without quotes.";
        foreach (var name in new[] { "warmup", "isRestDay", "flag" })
            hints[name] = $"{name} must be true or false, written without quotes.";
        foreach (var name in new[] { "name", "key", "id", "sourceName", "notes", "focus", "block", "phase", "kind", "type", "tempo",
            "loadText", "repsText", "restText", "rir", "sequenceGroup", "description", "reason" })
            hints[name] = $"{name} must be text, written in quotes.";
        return hints;
    }

    /// What one named field should hold.
    public static string For(string field) => Hints.TryGetValue(field, out var hint) ? hint : Fallback;

    /// The path cut back to the field that has the wrong type (so a bad value inside demoLinks is reported
    /// at demoLinks), with the sentence describing what that field should hold.
    public static (string Path, string Message) Describe(string path)
    {
        var segments = path.Split('.');
        for (var index = segments.Length - 1; index >= 1; index--)
        {
            var field = Regex.Replace(segments[index], @"\[\d+\]$", "");
            if (Hints.TryGetValue(field, out var hint)) return (string.Join('.', segments.Take(index + 1)), hint);
        }
        return (path, Fallback);
    }
}
