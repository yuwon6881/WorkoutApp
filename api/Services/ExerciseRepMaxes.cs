using System.Globalization;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// The heaviest load lifted for at least `Reps` reps, with the set that did it. `ActualReps` and
/// `Rir` are that set's own, so a "5 rep" record done for six reps one rep from failure says so.
public record RepMaxRecord(int Reps, double LoadKg, int ActualReps, string? Rir, DateOnly Date);

/// Which rep maxes an exercise's history is worth showing. A strength record is the load for a rep
/// count: 1, 3 and 5 are the standard benchmarks, and 8 and 10 cover the hypertrophy range where most
/// of this app's work lives. Past 10 the set is endurance, where the load says little about strength
/// and the 1RM estimate stops being valid (it is already unavailable beyond 12 reps to failure).
internal static class ExerciseRepMaxes
{
    /// Largest first, so a set that stands for a bigger target is not listed again for a smaller one.
    private static readonly int[] Targets = [10, 8, 5, 3, 1];

    /// A set counts as a rep max only when taken close to failure. Three reps in reserve is a
    /// working set, not a maximum; a set with no recorded effort is given the benefit of the doubt.
    public const double MaxReserve = 2;

    public static List<RepMaxRecord> From(IEnumerable<(Guid Id, int? Reps, string? Rir, double? Rpe, double Load, DateOnly Date)> sets)
    {
        var candidates = sets
            .Where(x => x.Load > 0 && x.Reps is > 0
                && (ProgressionEvidence.Reserve(x.Rir, x.Rpe) is not { } reserve || reserve <= MaxReserve))
            .ToList();
        var records = new List<RepMaxRecord>();
        Guid? listed = null;
        foreach (var target in Targets)
        {
            var best = candidates.Where(x => x.Reps >= target)
                .OrderByDescending(x => x.Load).ThenByDescending(x => x.Reps).ThenByDescending(x => x.Date)
                .Cast<(Guid Id, int? Reps, string? Rir, double? Rpe, double Load, DateOnly Date)?>().FirstOrDefault();
            // One set can hold several rep maxes (a heavy 5 is also the best 3); only the largest is news.
            if (best is not { } top || top.Id == listed) continue;
            listed = top.Id;
            records.Add(new RepMaxRecord(target, top.Load, top.Reps!.Value, ReserveText(top.Rir, top.Rpe), top.Date));
        }
        records.Reverse();
        return records;
    }

    public static List<RepMaxRecord> From(IEnumerable<(CompletedSet Set, double Load, DateOnly Date)> sets)
        => From(sets.Select(x => (x.Set.Id, x.Set.Reps, x.Set.Rir, x.Set.Rpe, x.Load, x.Date)));

    /// The reserve as the lifter reads it: whole reps, with 5+ kept as the lower bound it is.
    public static string? ReserveText(string? rir, double? rpe)
    {
        if (rir?.Trim() == "5+") return "5+";
        return ProgressionEvidence.Reserve(rir, rpe) is { } reserve
            ? Math.Round(reserve, MidpointRounding.AwayFromZero).ToString(CultureInfo.InvariantCulture)
            : null;
    }
}
