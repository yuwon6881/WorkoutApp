namespace Workout.Api.Services;

internal sealed class ExternalProgram
{
    public required string Name { get; init; }
    public int? SourceWeekDays { get; init; }
    public required List<ExternalDay> Days { get; init; }
    public List<ExternalAlternativeGroup>? AlternativeGroups { get; init; }
}

internal sealed class ExternalDay
{
    public required string Key { get; init; }
    public required int Week { get; init; }
    public required string Name { get; init; }
    public string? Focus { get; init; }
    public string? Notes { get; init; }
    public string? Block { get; init; }
    public string? Phase { get; init; }
    public int PhaseWeek { get; init; } = 1;
    public bool IsRestDay { get; init; }
    public ImportSourceReference? SourceReference { get; init; }
    public required List<ExternalExercise> Exercises { get; init; }
}

internal sealed class ExternalExercise
{
    public required string SourceName { get; init; }
    public string? Notes { get; init; }
    public string? SequenceGroup { get; init; }
    public List<string>? Substitutions { get; init; }
    public int? RestSeconds { get; init; }
    public string? DemoUrl { get; init; }
    public Dictionary<string, string>? DemoLinks { get; init; }
    public ImportSourceReference? SourceReference { get; init; }
    public ImportUncertainty? Uncertainty { get; init; }
    public required List<ExternalSet> Sets { get; init; }
}

internal sealed class ExternalSet
{
    public string? Type { get; init; }
    public int? RepMin { get; init; }
    public int? RepMax { get; init; }
    public double? TargetRpe { get; init; }
    public int? RestSeconds { get; init; }
    public string? Tempo { get; init; }
    public string? LoadText { get; init; }
    public string? Notes { get; init; }
    public string? RepsText { get; init; }
    public string? RestText { get; init; }
    public string? Rir { get; init; }
    public bool Warmup { get; init; }
    public ImportSourceReference? SourceReference { get; init; }
    public ImportUncertainty? Uncertainty { get; init; }
}

internal sealed class ExternalAlternativeGroup
{
    public required string Id { get; init; }
    public required string Kind { get; init; }
    public required List<ExternalAlternative> Members { get; init; }
}

internal sealed class ExternalAlternative
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public string? Description { get; init; }
    public ImportUncertainty? Uncertainty { get; init; }
    public required List<string> DayKeys { get; init; }
}
