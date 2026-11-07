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

/// Turns a program's printed %1RM into a load. A recognised percentage set is a prescribed set: the
/// percentage and the lifter's 1RM decide its load, ordinary progression never stands in for them,
/// and a set with no known 1RM keeps its load blank rather than borrowing one.
public static partial class PercentageLoad
{
    private const double MaxEffectiveReps = 8;
    private const int RecentSessions = 5;

    [GeneratedRegex(@"^\s*(?<a>\d+(?:\.\d+)?)(?:\s*[-–]\s*(?<b>\d+(?:\.\d+)?))?\s*%\s*(?:1\s*RM)?\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Printed();

    public static PercentBand? Parse(string? loadText)
    {
        if (string.IsNullOrWhiteSpace(loadText) || Printed().Match(loadText) is not { Success: true } match) return null;
        var low = double.Parse(match.Groups["a"].Value, CultureInfo.InvariantCulture);
        var high = match.Groups["b"].Success ? double.Parse(match.Groups["b"].Value, CultureInfo.InvariantCulture) : low;
        return low is >= 10 and <= 100 && high is >= 10 and <= 100 && high >= low ? new PercentBand(low, high) : null;
    }

    /// The best honest 1RM the recent heavy sets imply; high-rep sets say too little about a max.
    public static double? EstimateOneRepMax(IEnumerable<SetExposure> history)
        => history
            .Where(set => set.Technique is null && set.LoadKg is > 0 && set.Reps is > 0)
            .Where(set => set.Reps + (set.Rpe is { } rpe ? 10 - rpe : 0) <= MaxEffectiveReps)
            .Select(set => (set.SessionId, set.CompletedAt, Estimate: Progression.Estimate1Rm(set.LoadKg, set.Reps, set.Rpe)))
            .Where(set => set.Estimate is not null)
            .GroupBy(set => set.SessionId)
            .Select(session => (Date: session.Max(set => set.CompletedAt), Best: session.Max(set => set.Estimate)!.Value))
            .OrderByDescending(session => session.Date).Take(RecentSessions)
            .Select(session => (double?)session.Best).Max();

    public static OneRepMax? Resolve(double? typedKg, IEnumerable<SetExposure> history)
        => typedKg is > 0 ? new OneRepMax(typedKg.Value, false)
            : EstimateOneRepMax(history) is { } estimate ? new OneRepMax(estimate, true) : null;

    /// The load comes from the percentage and the 1RM alone (the middle of a band), the reps are the
    /// program's, and the printed effort stays a target the lifter adjusts to; the 1RM, not this load,
    /// is what to correct when the effort is far off. With no 1RM the load stays blank.
    public static SetProgressionSuggestion Apply(SetPrescription plan, SetProgressionSuggestion engine,
        double? oneRepMaxKg, bool estimated, LoadOptions loads)
    {
        if (plan.Warmup || engine.ResistanceMode == ResistanceModes.RepsOnly || Parse(plan.LoadText) is not { } band) return engine;
        var reps = plan.RepMin ?? engine.SuggestedReps;
        if (oneRepMaxKg is not > 0)
            return engine with { SuggestedLoadKg = null, SuggestedSystemLoadKg = null, SuggestedReps = reps,
                Reason = $"This set is {Label(band)} of your 1RM. Enter your 1RM in the exercise details to get a weight." };
        var of = estimated ? "your estimated 1RM" : "your 1RM";
        var load = Nearest(band.Mid / 100 * oneRepMaxKg.Value, loads);
        var middle = band.Low == band.High ? "" : "Middle of the band: ";
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
