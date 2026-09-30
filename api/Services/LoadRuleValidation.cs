using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Checks one incoming load rule and returns what to store: the step, the sorted distinct weight
/// list as JSON. Every load is canonical kilograms.
public static class LoadRuleValidation
{
    public static (double? StepKg, string? LoadsJson) Normalize(double? stepKg, List<double>? loadsKg)
    {
        Validation.Require(stepKg is null || loadsKg is null, "Choose a fixed increment or available weights.");
        if (stepKg is { } step) Validation.Number(step, 0, 50, "Weight increment");
        return (stepKg, loadsKg is null ? null : Json.Write(Weights(loadsKg)));
    }

    public static List<double> Weights(List<double> values)
    {
        Validation.Require(values.Count is >= 2 and <= 200, "Enter between 2 and 200 available weights.");
        foreach (var weight in values) Validation.Number(weight, 0, 1000, "Available weight");
        var weights = values.Distinct().Order().ToList();
        Validation.Require(weights.Count >= 2, "Enter at least two different available weights.");
        return weights;
    }
}
