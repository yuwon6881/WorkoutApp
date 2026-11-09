using Workout.Api.Services;

namespace Workout.Tests;

/// Builds an external AI-JSON file and converts it into a draft, the only way a draft now comes to exist.
internal static class ExternalDraftFixture
{
    public const string BenchExercise = """
    {"sourceName":"Barbell bench press","sets":[{"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":120}]}
    """;

    /// One training day per week, every day holding the given exercises, in a program named as given.
    public static string Weeks(int weeks, string programName = "Hypertrophy block", string exercises = BenchExercise)
    {
        var days = Enumerable.Range(1, weeks).Select(week =>
            $$"""{"key":"w{{week}}","week":{{week}},"name":"Day A","focus":"Push","exercises":[{{exercises}}]}""");
        return Program(programName, string.Join(",", days));
    }

    public static string Program(string programName, string daysJson)
        => $$$"""{"version":1,"program":{"name":"{{{programName}}}","days":[{{{daysJson}}}]}}""";

    public static Task<ImportView> Create(ImportService imports, string json)
        => imports.CreateExternalImport(json, "plan.json", default);
}
