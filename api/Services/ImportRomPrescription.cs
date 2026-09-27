namespace Workout.Api.Services;

/// Printed ROM fractions describe the same technique whether written as words or fractions.
internal static class ImportRomPrescription
{
    public const string Range = @"(?:half|1\s*/\s*[2-4]|[23]\s*/\s*4|2\s*/\s*3|[¼½¾])(?:\s+of)?\s+(?:the\s+)?(?:rom|range\s+of\s+motion)";
}
