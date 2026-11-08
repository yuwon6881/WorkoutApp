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
            "pdfPage" => reference.Page is > 0 and <= ImportSourceText.MaxPages
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

public sealed record ImportUncertainty(bool Flag, string? Reason = null)
{
    public static void Validate(ImportUncertainty? uncertainty)
    {
        if (uncertainty is null) return;
        // An unflagged reason ("clearly printed") is harmless: review only ever surfaces flagged items,
        // so rejecting the whole file for it would cost a correction round trip for nothing.
        Validation.Text(uncertainty.Reason, 200, "Uncertainty reason");
    }
}
