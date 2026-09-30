using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Checks one incoming load rule and returns what to store: the step, the sorted distinct weight
/// list as JSON, and the stack id. Every load is canonical kilograms.
public static class LoadRuleValidation
{
    public static (double? StepKg, string? LoadsJson, Guid? StackId) Normalize(double? stepKg, List<double>? loadsKg, Guid? stackId)
    {
        var chosen = (stepKg is null ? 0 : 1) + (loadsKg is null ? 0 : 1) + (stackId is null ? 0 : 1);
        Validation.Require(chosen <= 1, "Choose one of a fixed increment, available weights, or a weight stack.");
        if (stepKg is { } step) Validation.Number(step, 0, 50, "Weight increment");
        return (stepKg, loadsKg is null ? null : Json.Write(Weights(loadsKg)), stackId);
    }

    public static List<double> Weights(List<double> values)
    {
        Validation.Require(values.Count is >= 2 and <= 200, "Enter between 2 and 200 available weights.");
        foreach (var weight in values) Validation.Number(weight, 0, 1000, "Available weight");
        var weights = values.Distinct().Order().ToList();
        Validation.Require(weights.Count >= 2, "Enter at least two different available weights.");
        return weights;
    }

    /// A stack is referenced only by its owner; the tenancy filter hides everyone else's.
    public static async Task RequireStack(AppDb db, Guid? stackId, CancellationToken ct)
    {
        if (stackId is not { } id) return;
        Validation.Require(await db.LoadStacks.AnyAsync(x => x.Id == id, ct), "That weight stack no longer exists.", 404);
    }
}
