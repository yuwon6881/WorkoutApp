namespace Workout.Api.Domain;

/// The account display unit, and the unit a stored load step was typed in.
public static class WeightUnits
{
    public const string Kg = "kg";
    public const string Lb = "lb";

    public static bool IsKnown(string? unit) => unit is Kg or Lb;
}
