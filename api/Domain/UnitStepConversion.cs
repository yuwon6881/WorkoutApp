namespace Workout.Api.Domain;

/// Maps a load step typed in one unit to the nearest increment a gym in the other unit actually
/// has. Stored steps are never rewritten with this: it runs when a rule is read, so switching the
/// account unit back always shows the step exactly as it was typed.
public static class UnitStepConversion
{
    public const double PoundsPerKg = 2.2046226218;

    // Increments that exist on pound and kilogram equipment, smallest plates first.
    private static readonly double[] PoundSteps = [0.5, 1, 1.25, 2, 2.5, .. Enumerable.Range(1, 22).Select(i => i * 5.0)];
    private static readonly double[] KilogramSteps = [0.25, 0.5, 1, 1.25, 2, 2.5, 4, .. Enumerable.Range(2, 19).Select(i => i * 2.5)];

    /// The step in the reading unit, in canonical kg. Unchanged when the units match.
    public static double InUnit(double stepKg, string storedUnit, string unit, string? equipment)
    {
        if (stepKg <= 0 || storedUnit == unit) return stepKg;
        return unit == WeightUnits.Lb ? ConvertKgToLbStep(stepKg, equipment) : ConvertLbToKgStep(stepKg, equipment);
    }

    /// A kilogram step as the nearest pound step, returned in canonical kg.
    public static double ConvertKgToLbStep(double stepKg, string? equipment = null)
        => stepKg <= 0 ? 0 : Nearest(stepKg * PoundsPerKg, PoundSteps) / PoundsPerKg;

    /// A pound step (in canonical kg) as the nearest kilogram step.
    public static double ConvertLbToKgStep(double stepKg, string? equipment = null)
    {
        if (stepKg <= 0) return 0;
        var pounds = stepKg * PoundsPerKg;
        // Fixed kilogram dumbbells and kettlebells come in 2 kg and 4 kg jumps.
        switch (Equipment(equipment))
        {
            case "dumbbell" when Math.Abs(pounds - 5) < 0.5:
                return 2;
            case "kettlebell" when Math.Abs(pounds - 5) < 0.5 || Math.Abs(pounds - 10) < 0.5:
                return 4;
        }
        return Nearest(stepKg, KilogramSteps);
    }

    // Steps scale, so "nearest" is by ratio: 3.3 lb is closer to 2.5 than to 5.
    private static double Nearest(double value, double[] steps)
        => steps.MinBy(step => Math.Abs(Math.Log(value / step)));

    // Accepts catalog equipment names and EquipmentGroups keys alike.
    private static string Equipment(string? equipment)
        => (equipment ?? "").Trim().Replace('-', ' ').ToLowerInvariant();
}
