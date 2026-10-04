namespace Workout.Api.Data;

/// Last confirmed Nutrition context. It is a fallback only; a stale row never becomes a zero or
/// silently changes a completed workout's frozen context.
public sealed class NutritionContextCache : OwnedRecord
{
    public string ContextJson { get; set; } = "";
    public string? SummaryJson { get; set; }
    public DateOnly? SummaryFrom { get; set; }
    public DateOnly? SummaryTo { get; set; }
    public string? SummaryTimeZone { get; set; }
    public DateTime? SummaryFetchedAt { get; set; }
    public DateTime? LastSuccessAt { get; set; }
    public DateTime? LastErrorAt { get; set; }
    public string LastError { get; set; } = "";
}

