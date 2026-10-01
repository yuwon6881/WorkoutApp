using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Domain;

public static class UnitStepConversion
{
    public const double PoundsPerKg = 2.2046226218;

    /// Converts a step from kg to a sensible pound step (returned in canonical kg).
    public static double ConvertKgToLbStep(double stepKg, string? equipment = null)
    {
        if (stepKg <= 0) return 0;
        var rawLb = stepKg * PoundsPerKg;
        var eq = (equipment ?? "").Trim().ToLowerInvariant();
        double sensibleLb;
        if (eq == "medicine ball" || Math.Abs(rawLb - 2.2046) < 0.25)
        {
            sensibleLb = 2.0;
        }
        else if (rawLb < 0.75) sensibleLb = 0.5;
        else if (rawLb < 1.15) sensibleLb = 1.0;
        else if (rawLb < 1.75) sensibleLb = 1.25;
        else if (rawLb < 3.2) sensibleLb = 2.5;
        else if (rawLb < 7.5) sensibleLb = 5.0;
        else if (rawLb < 12.5) sensibleLb = 10.0;
        else sensibleLb = Math.Round(rawLb / 5.0) * 5.0;

        return sensibleLb / PoundsPerKg;
    }

    /// Converts a step from lb (stored in canonical kg) to a sensible kg step (returned in canonical kg).
    public static double ConvertLbToKgStep(double stepKg, string? equipment = null)
    {
        if (stepKg <= 0) return 0;
        var rawLb = stepKg * PoundsPerKg;
        var eq = (equipment ?? "").Trim().ToLowerInvariant();
        if (eq == "dumbbell" && Math.Abs(rawLb - 5.0) < 0.5)
            return 2.0;
        if (eq == "medicine ball" && Math.Abs(rawLb - 2.0) < 0.5)
            return 1.0;
        if (eq == "kettlebell" && (Math.Abs(rawLb - 5.0) < 0.5 || Math.Abs(rawLb - 10.0) < 0.5))
            return 4.0;

        double rawKg = rawLb / PoundsPerKg;
        if (rawKg < 0.35) return 0.25;
        if (rawKg < 0.75) return 0.5;
        if (rawKg < 1.05) return 1.0;
        if (rawKg < 1.6) return 1.25;
        if (rawKg < 2.2) return 2.0;
        if (rawKg < 3.75) return 2.5;
        if (rawKg < 6.25) return 5.0;
        return Math.Round(rawKg / 2.5) * 2.5;
    }

    /// When the user changes weight unit in preferences, converts any custom increments
    /// across equipment defaults, exercise settings, and custom exercises.
    public static async Task ConvertCustomSteps(AppDb db, Guid userId, string fromUnit, string toUnit, CancellationToken ct)
    {
        if (fromUnit == toUnit) return;
        var toLb = toUnit == "lb";

        // 1. Equipment defaults
        var equipmentDefaults = await db.EquipmentLoadDefaults.Where(x => x.UserId == userId).ToListAsync(ct);
        foreach (var row in equipmentDefaults)
        {
            if (row.LoadStepKg is { } step)
            {
                row.LoadStepKg = toLb
                    ? ConvertKgToLbStep(step, row.Equipment)
                    : ConvertLbToKgStep(step, row.Equipment);
                row.Revision++;
            }
        }

        // 2. Exercise load settings
        var exerciseSettings = await db.ExerciseLoadSettings.Where(x => x.UserId == userId).ToListAsync(ct);
        if (exerciseSettings.Count > 0)
        {
            var exerciseIds = exerciseSettings.Select(x => x.Id).ToList();
            var catalogEquip = await db.Exercises.AsNoTracking().Where(x => exerciseIds.Contains(x.Id))
                .Select(x => new { x.Id, x.Equipment }).ToDictionaryAsync(x => x.Id, x => x.Equipment, ct);
            var customEquip = await db.CustomExercises.AsNoTracking().Where(x => exerciseIds.Contains(x.Id))
                .Select(x => new { x.Id, x.Equipment }).ToDictionaryAsync(x => x.Id, x => x.Equipment, ct);

            foreach (var row in exerciseSettings)
            {
                if (row.LoadStepKg is { } step)
                {
                    var equip = catalogEquip.GetValueOrDefault(row.Id) ?? customEquip.GetValueOrDefault(row.Id);
                    row.LoadStepKg = toLb
                        ? ConvertKgToLbStep(step, equip)
                        : ConvertLbToKgStep(step, equip);
                    row.Revision++;
                }
            }
        }

        // 3. Custom exercises
        var customExercises = await db.CustomExercises.Where(x => x.UserId == userId && !x.Archived).ToListAsync(ct);
        foreach (var custom in customExercises)
        {
            if (custom.LoadStepKg > 0)
            {
                custom.LoadStepKg = toLb
                    ? ConvertKgToLbStep(custom.LoadStepKg, custom.Equipment)
                    : ConvertLbToKgStep(custom.LoadStepKg, custom.Equipment);
            }
        }
    }
}
