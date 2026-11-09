using Workout.Api.Domain;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Source locators are descriptive evidence, not proof that the source was checked.
public sealed record ImportSourceReference(string Kind, int? Page = null, string? Sheet = null,
    string? Cell = null, string? Text = null)
{
    public static ImportSourceReference? FromPage(int? page)
        => page is null ? null : new ImportSourceReference("pdfPage", Page: page);

    public static void Validate(ImportSourceReference? reference, int? legacyPage)
    {
        if (reference is null) return;
        var valid = reference.Kind switch
        {
            "pdfPage" => reference.Page is > 0 and <= ProgramLimits.MaxSourcePage
                && reference.Sheet is null && reference.Cell is null && reference.Text is null
                && (legacyPage is null || legacyPage == reference.Page),
            "sheetCell" => legacyPage is null && reference.Page is null && reference.Text is null
                && !string.IsNullOrWhiteSpace(reference.Sheet) && !string.IsNullOrWhiteSpace(reference.Cell)
                && reference.Sheet.Length <= 31 && reference.Sheet.IndexOfAny(['[', ']', ':', '*', '?', '/', '\\']) < 0
                && !reference.Sheet.Any(char.IsControl) && IsCellRange(reference.Cell),
            "text" => legacyPage is null && reference.Page is null && reference.Sheet is null && reference.Cell is null
                && !string.IsNullOrWhiteSpace(reference.Text) && reference.Text.Length <= 200,
            "none" => legacyPage is null && reference.Page is null && reference.Sheet is null
                && reference.Cell is null && reference.Text is null,
            _ => false
        };
        Validation.Require(valid, "The source reference is invalid.");
    }

    private static bool IsCellRange(string value)
    {
        if (value.Length > 32) return false;
        var cells = value.Split(':');
        return cells.Length is 1 or 2 && cells.All(IsCell);
    }

    private static bool IsCell(string value)
    {
        var match = Regex.Match(value, @"^\$?(?<column>[A-Za-z]{1,3})\$?(?<row>[1-9][0-9]{0,6})$", RegexOptions.CultureInvariant);
        if (!match.Success || !int.TryParse(match.Groups["row"].Value, out var row) || row > 1_048_576) return false;
        var column = 0;
        foreach (var letter in match.Groups["column"].Value.ToUpperInvariant()) column = column * 26 + letter - 'A' + 1;
        return column <= 16_384;
    }
}

/// One answer the assistant offers for a flagged detail. On an exercise it names a movement (the server fills in
/// ExerciseId from the library and drops a name the library does not hold); on a set it gives the reps or effort to use.
public sealed record ImportOption(string Label, string? ExerciseName = null, Guid? ExerciseId = null,
    int? RepMin = null, int? RepMax = null, double? TargetRpe = null);

public enum ImportOptionScope { None, Exercise, Set }

public sealed record ImportUncertainty(bool Flag, string? Reason = null, List<ImportOption>? Options = null)
{
    public const int MaxOptions = 4;

    public static void Validate(ImportUncertainty? uncertainty, ImportOptionScope scope = ImportOptionScope.None)
    {
        if (uncertainty is null) return;
        // An unflagged reason ("clearly printed") is harmless: review only ever surfaces flagged items,
        // so rejecting the whole file for it would cost a correction round trip for nothing.
        Validation.Text(uncertainty.Reason, 200, "Uncertainty reason");
        if (uncertainty.Options is not { Count: > 0 } options) return;
        Validation.Require(scope != ImportOptionScope.None, "Options can be offered on an exercise or a set, not here.");
        Validation.Require(options.Count <= MaxOptions, $"Offer at most {MaxOptions} options.");
        foreach (var option in options)
        {
            Validation.Require(option is not null, "Remove the empty option.");
            Validation.Name(option!.Label, "Option label", 80);
            if (scope == ImportOptionScope.Exercise) ValidateExerciseOption(option);
            else ValidateSetOption(option);
        }
    }

    private static void ValidateExerciseOption(ImportOption option)
    {
        Validation.Name(option.ExerciseName, "Option exercise name", 160);
        Validation.Require(option.RepMin is null && option.RepMax is null && option.TargetRpe is null,
            "An exercise option names a movement; put reps or effort options on a set.");
    }

    private static void ValidateSetOption(ImportOption option)
    {
        Validation.Require(option.ExerciseName is null, "A set option gives reps or effort; put movement options on the exercise.");
        Validation.Require((option.RepMin is null) == (option.RepMax is null), "Give both rep bounds or neither.");
        Validation.Require(option.RepMin is not null || option.TargetRpe is not null, "A set option needs reps or a target RPE.");
        if (option.RepMin is { } min && option.RepMax is { } max)
            Validation.Require(min is >= 1 and <= 1000 && max is >= 1 and <= 1000 && min <= max, "Option reps must be 1 to 1000, lowest first.");
        if (option.TargetRpe is { } rpe)
            Validation.Require(rpe is >= 6 and <= 10 && Math.Abs(rpe * 2 - Math.Round(rpe * 2)) < 1e-9, "Option target RPE must be 6 to 10 in half points.");
    }
}
