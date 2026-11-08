using System.Text;
using System.Text.Json;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Parses only the transport envelope. Domain validation must run before persisting a draft.
internal static class ExternalImportEnvelope
{
    public const int MaxBytes = 8 * 1024 * 1024;

    public static JsonDocument Parse(string input)
    {
        Validation.Require(Encoding.UTF8.GetByteCount(input) <= MaxBytes, "Use a JSON file no larger than 8 MiB; split the program if necessary.", 413);
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(input, new JsonDocumentOptions { MaxDepth = 64 });
        }
        catch (JsonException error)
        {
            throw new DomainException(ParseFailure(input, error), 400);
        }

        try
        {
            CheckDuplicates(document.RootElement, "$");
            var root = document.RootElement;
            ExternalImportPath.At("$.program", () => Validation.Require(root.ValueKind == JsonValueKind.Object, "Use a JSON object containing version and program."));
            if (!root.TryGetProperty("version", out var version)
                || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var number) || number != 1)
                throw ExternalImportPath.WithPath(new DomainException("Use external import format version 1 and set version to 1."), "$.version");
            ExternalImportPath.At("$.program", () => Validation.Require(root.TryGetProperty("program", out var program) && program.ValueKind == JsonValueKind.Object,
                "Add a program object."));
            return document;
        }
        catch
        {
            document.Dispose();
            throw;
        }
    }

    /// Says what is wrong with text that is not JSON, and where, so it can be fixed or sent back to the assistant.
    /// Only positions and fixed wording are reported; the file's own content is never echoed.
    private static string ParseFailure(string input, JsonException error)
    {
        var text = input.TrimStart('\uFEFF', ' ', '\t', '\r', '\n');
        if (text.Length == 0) return "The file is empty. Ask the assistant to produce the JSON file again.";
        if (text.StartsWith("```", StringComparison.Ordinal))
            return "The file starts with a Markdown code fence (three backticks). Save only the JSON, from the opening { to the closing }.";
        if (text[0] != '{')
            return "The file does not start with {. It must contain only the JSON object, with no text before or after it.";
        var where = error.LineNumber is { } line ? $" near line {line + 1}, column {(error.BytePositionInLine ?? 0) + 1}" : "";
        return $"The file is not complete, valid JSON{where}. It may have been cut off, or have text outside the JSON. Ask the assistant to produce the whole file again.";
    }

    private static void CheckDuplicates(JsonElement element, string path)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var property in element.EnumerateObject())
            {
                var propertyPath = $"{path}.{property.Name}";
                ExternalImportPath.At(propertyPath, () => Validation.Require(keys.Add(property.Name), "Remove the duplicate field."));
                CheckDuplicates(property.Value, propertyPath);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            var index = 0;
            foreach (var item in element.EnumerateArray()) CheckDuplicates(item, $"{path}[{index++}]");
        }
    }
}
