namespace Workout.Api.Domain;

/// Describes the load the user enters, independently of units or the number of implements.
public static class WeightBases
{
    public const string Total = "total";
    public const string PerSide = "per_side";
    public static bool IsValid(string value) => value is Total or PerSide;
}
