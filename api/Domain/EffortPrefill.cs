using System.Globalization;

namespace Workout.Api.Domain;

/// The reserve a set starts with when the lifter has done the movement before: the program's own
/// target, else the same default the logger shows ("Default 2 RIR"), so the lifter sees the effort
/// the plan intends next to the load and reps the history already fills in.
public static class EffortPrefill
{
    public const int DefaultReserve = 2;

    /// The recorded effort pair, in the shape a logged set stores: RIR text plus RPE (10 − RIR, absent
    /// at 5+ reserve). Null when the set should stay blank: a technique with no printed effort
    /// (a drop set or partials is taken to its own end), or a set that is not rep-based.
    public static (string Rir, double? Rpe)? For(SetPrescription prescription)
    {
        var printed = ProgressionEvidence.Reserve(prescription.Rir, prescription.TargetRpe);
        if (printed is null && SetTechniques.Of(prescription) is not null) return null;
        var reserve = (int)Math.Round(printed ?? DefaultReserve, MidpointRounding.AwayFromZero);
        if (reserve >= 5) return ("5+", null);
        return (reserve.ToString(CultureInfo.InvariantCulture), (double?)(10 - reserve));
    }
}
