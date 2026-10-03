namespace Workout.Api.Services.AI.Tools;

/// Canonical kilograms shown to the model in the account's display unit. Unknown stays unknown.
internal static class AiToolUnits
{
    public static double? Weight(double? weightKg, string unit)
    {
        if (weightKg is not { } kg) return null;
        return unit.Equals("lb", StringComparison.OrdinalIgnoreCase) ? Math.Round(kg * 2.20462, 1) : Math.Round(kg, 1);
    }
}
