using System.Globalization;
using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Carries can be prescribed by count or distance while the logged measurement is elapsed time.
public static class CarryTargetUnits
{
    public static string? Text(string? printed, int? minimum, int? maximum, string? name, string? notes)
    {
        if (!Regex.IsMatch(name ?? "", @"\b(?:walks?|carr(?:y|ies))\b", RegexOptions.IgnoreCase)
            || minimum is null || minimum != maximum
            || !Regex.IsMatch(printed ?? "", @"^\s*\d+\s*$")
            || !int.TryParse(printed?.Trim(), out var printedCount) || printedCount != minimum) return printed;
        var units = Regex.Matches(notes ?? "", @"\b(\d+)\s+(?:total\s+)?(strides?|steps?|metres?|meters?|yards?|feet)\b",
                RegexOptions.IgnoreCase)
            .Where(match => int.TryParse(match.Groups[1].Value, out var count) && count == minimum)
            .Select(match => match.Groups[2].Value.ToLowerInvariant()).Distinct().ToList();
        return units.Count == 1 ? $"{minimum.Value.ToString(CultureInfo.InvariantCulture)} {units[0]}" : printed;
    }

    public static List<SetPrescription> Prescriptions(List<SetPrescription> sets, string name, string? notes) =>
        sets.Select(set => set.Warmup ? set : set with
        {
            RepsText = Text(set.RepsText, set.RepMin, set.RepMax, name, notes)
        }).ToList();
}
