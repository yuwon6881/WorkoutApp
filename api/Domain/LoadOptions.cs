namespace Workout.Api.Domain;

/// Available loads in the same kg convention as the logged exercise. Resolve an exercise's
/// settings before calling progression; the policy must not infer increments from equipment names.
/// Origin and bounds also describe bodyweight plus added load or bodyweight minus assistance.
public sealed record LoadOptions(double StepKg, double OriginKg = 0, double MinimumKg = 0, double MaximumKg = 1000,
    IReadOnlyList<double>? AvailableLoadsKg = null)
{
    public bool Adjustable => AvailableLoadsKg is { Count: > 1 } || double.IsFinite(StepKg) && StepKg > 0;

    public double AtMost(double value)
    {
        var bounded = Math.Clamp(value, MinimumKg, MaximumKg);
        if (AvailableLoadsKg is { Count: > 0 } values)
            return values.Where(x => x <= bounded + 1e-9).DefaultIfEmpty(values.Min()).Max();
        if (!Adjustable) return bounded;
        var result = OriginKg + Math.Floor((bounded - OriginKg + 1e-9) / StepKg) * StepKg;
        return Math.Clamp(result, MinimumKg, MaximumKg);
    }

    public double Next(double current)
    {
        if (AvailableLoadsKg is { Count: > 0 } values)
            return values.Where(x => x > current + .00051).DefaultIfEmpty(current).Min();
        if (!Adjustable) return current;
        var result = OriginKg + (Math.Floor((current - OriginKg + .00051) / StepKg) + 1) * StepKg;
        return result <= MaximumKg ? result : current;
    }

    public double Previous(double current)
    {
        if (AvailableLoadsKg is { Count: > 0 } values)
            return values.Where(x => x < current - .00051).DefaultIfEmpty(current).Max();
        if (!Adjustable) return current;
        var result = OriginKg + (Math.Ceiling((current - OriginKg - .00051) / StepKg) - 1) * StepKg;
        return result >= MinimumKg ? result : current;
    }
}
