using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Domain;

/// A printed percentage of one-rep max, or a band such as 82.5-87.5%.
public readonly record struct PercentBand(double Low, double High)
{
    public double Mid => (Low + High) / 2;
}

/// A lifter's one-rep max for a lift: typed by them, or estimated from their logged sets.
public readonly record struct OneRepMax(double Kg, bool Estimated);

/// Turns a program's printed %1RM into a load. Back-off sets follow the percentage; a set that also
/// prints an effort target keeps the effort-adjusted load, held inside its band, so the program's
/// weekly wave moves the load without overriding how the set felt.
public static partial class PercentageLoad
{
    public const string PriorSetNote = "Percentage of top set";
    public static bool IsRelative(SetPrescription set) => (set.Notes ?? "").Contains(PriorSetNote, StringComparison.OrdinalIgnoreCase)
        || Regex.IsMatch(set.LoadText ?? "", @"%\s+of\s+(?:the\s+)?(?:top|previous|amrap)\s+set", RegexOptions.IgnoreCase);
    private const double MaxEffectiveReps = 8;
    private const int RecentSessions = 5;
    private const int MaxEstimateAgeDays = 90;

    [GeneratedRegex(@"^\s*(?<a>\d+(?:\.\d+)?)(?:\s*[-–]\s*(?<b>\d+(?:\.\d+)?))?\s*%\s*(?:1\s*RM)?\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Printed();

    public static PercentBand? Parse(string? loadText)
    {
        if (string.IsNullOrWhiteSpace(loadText) || Printed().Match(loadText) is not { Success: true } match) return null;
        var low = double.Parse(match.Groups["a"].Value, CultureInfo.InvariantCulture);
        var high = match.Groups["b"].Success ? double.Parse(match.Groups["b"].Value, CultureInfo.InvariantCulture) : low;
        return low is >= 10 and <= 125 && high is >= 10 and <= 125 && high >= low ? new PercentBand(low, high) : null;
    }

    /// The best honest 1RM the recent heavy sets imply; high-rep sets say too little about a max.
    public static double? EstimateOneRepMax(IEnumerable<SetExposure> history, DateTime? now = null)
    {
        var cutoff = (now ?? DateTime.UtcNow).AddDays(-MaxEstimateAgeDays);
        return history
            .Where(set => set.CompletedAt >= cutoff && set.Technique is null && set.LoadKg is > 0 && set.Reps is > 0 && set.Rir != "5+")
            .Where(set => set.Reps + (set.Rpe is { } rpe ? 10 - rpe : 0) <= MaxEffectiveReps)
            .Select(set => (set.SessionId, set.CompletedAt, Estimate: Progression.Estimate1Rm(set.LoadKg, set.Reps, set.Rpe)))
            .Where(set => set.Estimate is not null)
            .GroupBy(set => set.SessionId)
            .Select(session => (Date: session.Max(set => set.CompletedAt), Best: session.Max(set => set.Estimate)!.Value))
            .OrderByDescending(session => session.Date).Take(RecentSessions)
            .Select(session => (double?)session.Best).Max();
    }

    public static OneRepMax? Resolve(double? typedKg, IEnumerable<SetExposure> history)
        => typedKg is > 0 ? new OneRepMax(typedKg.Value, false)
            : EstimateOneRepMax(history) is { } estimate ? new OneRepMax(estimate, true) : null;

    /// A recognised percentage set is a prescribed set: the load comes from the percentage and the
    /// lifter's 1RM alone (the middle of a band), the reps are the program's, and ordinary progression
    /// neither moves nor stands in for them. The printed effort stays a target the lifter adjusts to; the
    /// 1RM, not this load, is what to correct when the effort is far off. With no 1RM the load stays blank.
    public static SetProgressionSuggestion Apply(SetPrescription plan, SetProgressionSuggestion engine,
        double? oneRepMaxKg, bool estimated, LoadOptions loads)
    {
        if (plan.Warmup || engine.ResistanceMode == ResistanceModes.RepsOnly) return engine;
        if (IsRelative(plan))
            return engine with { SuggestedLoadKg = null, SuggestedSystemLoadKg = null, SuggestedReps = plan.RepMin ?? engine.SuggestedReps,
                Reason = "Use the prescribed percentage of the load used in the earlier set." };
        if (Parse(plan.LoadText) is not { } band) return engine;
        var reps = plan.RepMin ?? engine.SuggestedReps;
        if (oneRepMaxKg is not > 0)
            return engine with { SuggestedLoadKg = null, SuggestedSystemLoadKg = null, SuggestedReps = reps,
                Reason = $"This set is {Label(band)} of your 1RM. Enter your 1RM in the exercise details to get a weight; an estimate needs a recent heavy set." };
        var of = estimated ? "your estimated 1RM" : "your 1RM";
        var opener = Regex.IsMatch(plan.Notes ?? "", @"\bstart\s+(?:with|at)\s+100\s*%", RegexOptions.IgnoreCase) && band.Low == 100;
        var load = Nearest((opener ? band.Low : band.Mid) / 100 * oneRepMaxKg.Value, loads);
        var middle = opener ? "Start at the bottom of the band: " : band.Low == band.High ? "" : "Middle of the band: ";
        var effort = ProgressionEvidence.Reserve(plan.Rir, plan.TargetRpe) is null ? ""
            : " Adjust to the target effort; if it is far off, correct your 1RM.";
        return engine with { SuggestedLoadKg = load, SuggestedReps = reps,
            Reason = $"{middle}{Label(band)} of {of}.{effort}" };
    }

    private static string Label(PercentBand band)
    {
        var low = band.Low.ToString("0.##", CultureInfo.InvariantCulture);
        return band.Low == band.High ? $"{low}%" : $"{low}-{band.High.ToString("0.##", CultureInfo.InvariantCulture)}%";
    }

    private static double Nearest(double kg, LoadOptions loads)
    {
        if (!loads.Adjustable) return kg;
        var down = loads.AtMost(kg);
        var up = loads.Next(down);
        return up > down && up - kg < kg - down ? up : down;
    }
}
