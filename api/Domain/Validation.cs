using System.Text.Json;
using Workout.Api.Services;

namespace Workout.Api.Domain;

public sealed class DomainException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

/// One prescribed set. Rep ranges and per-set differences are preserved exactly as written,
/// so a program that asks for 8-10 on set one and 12 on set three stays that way.
public record SetPrescription(
    int RepMin, int RepMax, double? TargetRpe, int? RestSeconds, string? Tempo, string? LoadText, string? Notes,
    string? RepsText = null, string? RestText = null, string? Percent1Rm = null, string? Rir = null,
    bool Warmup = false, string RepsSource = "extracted", string RpeSource = "extracted", string RestSource = "extracted",
    string ResistanceMode = ResistanceModes.External);

public static class Validation
{
    public static void Require(bool condition, string message, int status = 400)
    { if (!condition) throw new DomainException(message, status); }
    public static void Number(double number, double min, double max, string name) => Require(double.IsFinite(number) && number >= min && number <= max, $"{name} must be between {min} and {max}.");
    public static void Text(string? value, int max, string name) => Require(value == null || value.Length <= max, $"{name} must be {max} characters or fewer.");

    /// RPE is rated 1-10 in half-point steps. Anything finer is a data-entry error, not precision.
    public static void Rpe(double value, string name = "RPE")
    {
        Number(value, 1, 10, name);
        Require(Math.Abs(value * 2 - Math.Round(value * 2)) < 1e-9, $"{name} must use whole or half points.");
    }

    public static void Unit(string unit) => Require(unit is "kg" or "lb", "Choose kilograms or pounds.");
    public static void Theme(string theme) => Require(theme is "dark" or "light", "Choose the dark or light theme.");
    public static void RestSeconds(int seconds) => Require(seconds is >= 0 and <= 600, "Rest must be between 0 and 600 seconds.");

    public static void Name(string? value, string what, int max = 120)
    {
        Require(!string.IsNullOrWhiteSpace(value), $"{what} is required.");
        Require(value!.Trim().Length <= max, $"{what} must be {max} characters or fewer.");
    }

    /// A logged set: null weight stays unknown, zero is a real bodyweight set. Reps and RPE
    /// may be blank while the set is being typed; a completed set needs reps, while missing RPE
    /// remains a valid recorded exposure that deliberately pauses progression.
    public static void LoggedSet(double? weightKg, int? reps, double? rpe, bool done, bool warmup = false)
    {
        if (weightKg is { } weight) Number(weight, 0, 1000, "Weight");
        if (reps is { } count) Require(count is > 0 and <= 1000, "Reps must be between 1 and 1000.");
        if (rpe is { } effort) Rpe(effort);
        if (done) Require(reps != null, "A completed set needs its reps.");
    }

    public static List<SetPrescription> Prescriptions(string json)
    {
        Require(json.Length <= 8000, "This exercise has too much prescription detail.");
        List<SetPrescription>? sets;
        try { sets = Json.Read<List<SetPrescription>>(json); }
        catch (JsonException) { throw new DomainException("Set prescriptions must be valid JSON."); }
        Prescriptions(sets);
        return sets;
    }

    public static void Prescriptions(List<SetPrescription>? sets, bool requireWorkingRpe = false)
    {
        Require(sets is { Count: > 0 }, "Each exercise needs at least one set.");
        Require(sets!.Count <= 24, "An exercise can have at most 24 sets.");
        var workingStarted = false;
        foreach (var set in sets)
        {
            Require(set is not null, "A set is missing its details.");
            Require(set!.RepMin is > 0 and <= 1000 && set.RepMax is > 0 and <= 1000, "Reps must be between 1 and 1000.");
            Require(set.RepMin <= set.RepMax, "The lowest rep target cannot exceed the highest.");
            if (set.TargetRpe is { } target)
            {
                Number(target, 6, 10, "Target RPE");
                Require(Math.Abs(target * 2 - Math.Round(target * 2)) < 1e-9, "Target RPE must use whole or half points.");
            }
            else Require(!requireWorkingRpe || set.Warmup, "Working sets need a target RPE between 6 and 10.");
            if (set.RestSeconds is { } rest) Require(rest is >= 0 and <= 3600, "Rest must be between 0 and 3600 seconds.");
            if (!set.Warmup) workingStarted = true;
            else Require(!workingStarted, "Warm-up sets must come before working sets.");
            Text(set.Tempo, 24, "Tempo"); Text(set.LoadText, 60, "Load"); Text(set.Notes, 400, "Set notes");
            Text(set.RepsText, 40, "Verbatim reps"); Text(set.RestText, 24, "Verbatim rest");
            Text(set.Percent1Rm, 24, "%1RM"); Text(set.Rir, 16, "RIR");
            Require(ResistanceModes.All.Contains(set.ResistanceMode), "Unknown resistance mode.");
            foreach (var source in new[] { set.RepsSource, set.RpeSource, set.RestSource })
                Require(source is "extracted" or "inferred" or "userEdited", "Unknown provenance label.");
        }
    }

    public static void Substitutions(List<string>? substitutions)
    {
        Require(substitutions is null || substitutions.Count <= 2, "An exercise can have at most 2 substitutions.");
        foreach (var substitution in substitutions ?? []) Name(substitution, "Substitution", 160);
    }
}
