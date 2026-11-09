using System.Globalization;

namespace Workout.Api.Services;

/// The app stores a target effort as an RPE from 6 to 10; easier effort is stored as reps in reserve, which the
/// logger shows as "5+". A document can print a lower RPE (a deload or back-off set), and refusing the whole file
/// for a value the assistant reported faithfully would stop a real program from importing.
internal static class ExternalImportEffort
{
    /// The lowest RPE worth keeping; below it the value is not an effort at all and is left for validation to refuse.
    private const double LowestRpe = 1;
    private const double SupportedFloor = 6;
    private const double HighestRpe = 10;

    /// Re-expresses an RPE below the supported range as reps in reserve and says what was printed.
    /// RPE 5 is five reps in reserve, as the PDF reader reads it; anything easier is "5+", at least five.
    /// A reps-in-reserve value the file already states is kept as it is.
    public static (double? TargetRpe, string? Rir, string? Note) Express(double? targetRpe, string? rir)
    {
        if (targetRpe is not { } rpe || !double.IsFinite(rpe) || rpe < LowestRpe) return (targetRpe, rir, null);
        if (rpe >= SupportedFloor)
        {
            // The app records effort in half points; a quarter point such as 8.25 is the nearest half with the printed value kept.
            var snapped = Math.Round(rpe * 2, MidpointRounding.AwayFromZero) / 2;
            return rpe <= HighestRpe && Math.Abs(rpe - snapped) > 1e-9
                ? (snapped, rir, $"Printed RPE: {rpe.ToString("0.##", CultureInfo.InvariantCulture)}.")
                : (targetRpe, rir, null);
        }
        var derived = rpe >= 5
            ? ((int)Math.Round(10 - rpe, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture)
            : "5+";
        return (null, string.IsNullOrWhiteSpace(rir) ? derived : rir, $"Printed RPE: {rpe.ToString("0.##", CultureInfo.InvariantCulture)}.");
    }
}
