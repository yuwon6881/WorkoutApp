namespace Workout.Api.Services.AI.Tools;

// Per-turn state shared by every tool call in one assistant turn.
public sealed class AiToolContext
{
    public AiToolContext(
        string weightUnit,
        DateOnly today,
        AiTurnBudget? budget = null,
        string timeZone = "UTC",
        bool trackRir = true)
    {
        WeightUnit = weightUnit;
        Today = today;
        Budget = budget ?? new AiTurnBudget();
        Zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        TrackRir = trackRir;
    }

    public string WeightUnit { get; }
    public DateOnly Today { get; }
    public AiEvidenceLedger Evidence { get; } = new();
    public AiTurnBudget Budget { get; }
    public TimeZoneInfo Zone { get; }
    public bool TrackRir { get; }
    public DateOnly LocalDate(DateTime utc) => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Zone));
    public DateTime DayStartUtc(DateOnly date) => TimeZoneInfo.ConvertTimeToUtc(
        date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified), Zone);
}

// Every record id a tool showed the model this turn. A proposed action may only target a
// record the model actually saw, so an id cannot be guessed or lifted from untrusted text.
public sealed class AiEvidenceLedger
{
    public const string Workout = "workout";
    public const string Exercise = "exercise";
    public const string Program = "program";
    public const string Template = "template";
    public const string CustomExercise = "customExercise";

    private readonly HashSet<(string Kind, string Id)> _records = [];

    public void Record(string kind, string? id)
    {
        if (!string.IsNullOrWhiteSpace(id)) _records.Add((kind, id));
    }

    public void RecordAll(string kind, IEnumerable<string?> ids)
    {
        foreach (var id in ids) Record(kind, id);
    }

    public bool Contains(string kind, string? id) =>
        !string.IsNullOrWhiteSpace(id) && _records.Contains((kind, id));

    public void MergeFrom(AiEvidenceLedger other) => _records.UnionWith(other._records);

    public IReadOnlyList<string> IdsOf(string kind) =>
        _records.Where(record => record.Kind == kind).Select(record => record.Id).ToList();
}

// Bounds one turn's tool work so a looping model cannot run up cost or flood its own context.
public sealed class AiTurnBudget
{
    public const int DefaultMaxToolCalls = 8;
    public const int DefaultMaxResultCharacters = 40_000;
    public const int DefaultMaxCharactersPerResult = 12_000;

    public AiTurnBudget(
        int maxToolCalls = DefaultMaxToolCalls,
        int maxResultCharacters = DefaultMaxResultCharacters,
        int maxCharactersPerResult = DefaultMaxCharactersPerResult)
    {
        RemainingToolCalls = maxToolCalls;
        RemainingResultCharacters = maxResultCharacters;
        MaxCharactersPerResult = maxCharactersPerResult;
    }

    public int RemainingToolCalls { get; private set; }
    public int RemainingResultCharacters { get; private set; }
    public int MaxCharactersPerResult { get; }

    public bool TryReserveCall()
    {
        if (RemainingToolCalls <= 0) return false;
        RemainingToolCalls--;
        return true;
    }

    public bool TryConsumeCharacters(int count)
    {
        if (count > MaxCharactersPerResult || count > RemainingResultCharacters) return false;
        RemainingResultCharacters -= count;
        return true;
    }
}
