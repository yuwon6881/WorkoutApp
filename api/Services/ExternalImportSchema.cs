using System.Text.Json;
using Workout.Api.Domain;

namespace Workout.Api.Services;

internal static class ExternalImportSchema
{
    private const int MaxErrors = 100;
    private static readonly HashSet<string> Ignored = new(StringComparer.OrdinalIgnoreCase)
        { "verified", "checked", "id", "lineId", "exerciseId", "slotKey", "blockId", "weekId", "movementKey", "programId", "userId", "importId" };

    public static void Validate(JsonElement root)
    {
        ExternalImportPath.At("$", () => Object(root, "file", ["version", "program"]));
        if (!root.TryGetProperty("program", out var program)) return;
        ExternalImportPath.At("$.program", () => ValidateProgram(program));
    }

    private static void ValidateProgram(JsonElement program)
    {
        Object(program, "program", ["name", "sourceWeekDays", "days", "alternativeGroups"]);
        Required(program, "name", "days");
        Each(program, "days", day =>
        {
            Object(day, "day", ["key", "week", "name", "focus", "notes", "block", "phase", "phaseWeek", "isRestDay", "sourceReference", "exercises"]);
            Required(day, "key", "week", "name", "exercises");
            Reference(day); Each(day, "exercises", exercise =>
            {
                Object(exercise, "exercise", ["sourceName", "notes", "sequenceGroup", "substitutions", "restSeconds", "demoUrl", "demoLinks", "sourceReference", "uncertainty", "sets"]);
                Required(exercise, "sourceName", "sets");
                Reference(exercise); Uncertainty(exercise); LinkAndSubstitutionTypes(exercise);
                Each(exercise, "sets", set =>
                {
                    Object(set, "set", ["type", "repMin", "repMax", "targetRpe", "restSeconds", "tempo", "loadText", "notes", "repsText", "restText", "rir", "warmup", "sourceReference", "uncertainty"]);
                    Reference(set); Uncertainty(set);
                });
            });
        });
        Each(program, "alternativeGroups", group =>
        {
            Object(group, "alternative group", ["id", "kind", "members"]);
            Required(group, "id", "kind", "members");
            Each(group, "members", member =>
            {
                Object(member, "alternative", ["id", "name", "description", "uncertainty", "dayKeys"]);
                Required(member, "id", "name", "dayKeys");
                Uncertainty(member);
            });
        });
    }

    private static void Reference(JsonElement owner)
    {
        if (TryProperty(owner, "sourceReference", out var value) && value.ValueKind != JsonValueKind.Null)
            Relative("sourceReference", () => Object(value, "source reference", ["kind", "page", "sheet", "cell", "text"]));
    }

    /// The JSON reader reports a wrong value inside a map or list only at the exercise, so the shapes an
    /// assistant most often gets wrong are checked here, where the field can be named exactly.
    private static void LinkAndSubstitutionTypes(JsonElement exercise)
    {
        CheckShape(exercise, "demoUrl", value => value.ValueKind == JsonValueKind.String);
        CheckShape(exercise, "demoLinks", value => value.ValueKind == JsonValueKind.Object
            && value.EnumerateObject().All(entry => entry.Value.ValueKind is JsonValueKind.String or JsonValueKind.Null));
        CheckShape(exercise, "substitutions", value => value.ValueKind == JsonValueKind.Array
            && value.EnumerateArray().All(entry => entry.ValueKind == JsonValueKind.String));
    }

    private static void CheckShape(JsonElement owner, string property, Func<JsonElement, bool> valid)
    {
        if (TryProperty(owner, property, out var value) && value.ValueKind != JsonValueKind.Null)
            Relative(property, () => Validation.Require(valid(value), ExternalImportFieldHints.For(property)));
    }

    private static void Uncertainty(JsonElement owner)
    {
        if (TryProperty(owner, "uncertainty", out var value) && value.ValueKind != JsonValueKind.Null)
        {
            Relative("uncertainty", () => {
                Object(value, "uncertainty", ["flag", "reason"]);
                Validation.Require(TryProperty(value, "flag", out var flag) && flag.ValueKind is JsonValueKind.True or JsonValueKind.False,
                    "Uncertainty requires a true or false flag.");
            });
        }
    }

    private static void Each(JsonElement owner, string property, Action<JsonElement> action)
    {
        if (!TryProperty(owner, property, out var value) || value.ValueKind == JsonValueKind.Null) return;
        Relative(property, () => {
            Validation.Require(value.ValueKind == JsonValueKind.Array, $"{property} must be a list.");
            var index = 0;
            var failures = new List<ExternalImportPath.FieldError>();
            foreach (var item in value.EnumerateArray())
            {
                var position = index++;
                try { action(item); }
                catch (DomainException error)
                {
                    var nested = ExternalImportPath.RelativeErrorsOf(error)
                        ?? [new(ExternalImportPath.RelativePathOf(error) ?? "", error.Message)];
                    failures.AddRange(nested.Take(MaxErrors - failures.Count)
                        .Select(item => item with { Path = $"[{position}]{item.Path}" }));
                    if (failures.Count >= MaxErrors) break;
                }
            }
            ThrowErrors(failures);
        });
    }

    private static void Relative(string part, Action action)
    {
        try { action(); }
        catch (DomainException error)
        {
            ExternalImportPath.SetRelative(error, $".{part}{ExternalImportPath.RelativePathOf(error)}",
                PrefixedErrors(error, $".{part}"));
            throw;
        }
    }

    private static List<ExternalImportPath.FieldError>? PrefixedErrors(DomainException error, string prefix)
        => ExternalImportPath.RelativeErrorsOf(error)?.Select(item => item with { Path = prefix + item.Path }).ToList();

    private static bool TryProperty(JsonElement owner, string name, out JsonElement value)
    {
        if (owner.ValueKind == JsonValueKind.Object)
            foreach (var property in owner.EnumerateObject())
                if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase)) { value = property.Value; return true; }
        value = default;
        return false;
    }

    private static void Required(JsonElement owner, params string[] names)
    {
        var errors = names.Where(name => !TryProperty(owner, name, out var value) || value.ValueKind == JsonValueKind.Null)
            .Select(name => new ExternalImportPath.FieldError($".{name}", $"Add the required {name} field.")).ToList();
        ThrowErrors(errors);
    }

    private static void Object(JsonElement value, string name, string[] fields)
    {
        Validation.Require(value.ValueKind == JsonValueKind.Object, $"Each {name} must be an object.");
        var allowed = new HashSet<string>(fields, StringComparer.OrdinalIgnoreCase);
        var errors = value.EnumerateObject().Where(property => !allowed.Contains(property.Name) && !Ignored.Contains(property.Name))
            .Take(MaxErrors)
            .Select(property => new ExternalImportPath.FieldError($".{property.Name}", $"Remove the unsupported {name} field: {property.Name}."))
            .ToList();
        ThrowErrors(errors);
    }

    private static void ThrowErrors(List<ExternalImportPath.FieldError> errors)
    {
        if (errors.Count == 0) return;
        throw ExternalImportPath.WithRelativeErrors(errors[0].Message, errors);
    }
}
