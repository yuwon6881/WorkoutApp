namespace Workout.Api.Services.AI.Tools;

/// All-time records of one exercise for Ask AI, read from the same whole-history insight the
/// exercise details screen shows, so the model and the app never disagree about a best.
internal static class ExerciseRecordsSummary
{
    public sealed record Dated(double? Value, string? Date);
    public sealed record HeaviestSet(double? Weight, int? Reps, string? Date);

    public sealed record Records(
        int Sessions, string? FirstLogged, string? LastPerformed, Dated? BestEstimated1rm, HeaviestSet? HeaviestSet,
        Dated? MostReps, Dated? BestSessionVolume, bool PartialVolume);

    public static async Task<Records?> Read(ExerciseService exercises, Guid exerciseId, string unit, CancellationToken ct)
    {
        var insight = await exercises.Insight(exerciseId, "all", 0, 1, ct);
        if (insight.Sessions == 0) return null;
        return new Records(
            insight.Sessions,
            Date(insight.Points.Count == 0 ? null : insight.Points.Min(point => point.Date)),
            Date(insight.LastPerformedDate),
            insight.Estimated1RmKg is null ? null : new Dated(AiToolUnits.Weight(insight.Estimated1RmKg, unit), Date(insight.Estimated1RmDate)),
            insight.HeaviestKg is null ? null : new HeaviestSet(AiToolUnits.Weight(insight.HeaviestKg, unit), insight.HeaviestReps, Date(insight.HeaviestDate)),
            insight.RepPr is null ? null : new Dated(insight.RepPr, Date(insight.RepPrDate)),
            insight.LargestSessionVolumeKg is null ? null
                : new Dated(AiToolUnits.Weight(insight.LargestSessionVolumeKg, unit), Date(insight.LargestSessionVolumeDate)),
            insight.PartialVolume);
    }

    private static string? Date(DateOnly? date) => date?.ToString("yyyy-MM-dd");
}
