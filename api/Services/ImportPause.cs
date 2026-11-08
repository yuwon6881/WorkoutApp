using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Resolves a pause prescription only when the catalog spells the same movement with a pause.
internal static class ImportPause
{
    private static readonly Regex Pause = new(@"(?<!rest-)(?<!rest )\bpause(?:d|s|ing)?\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex NotRepPause = new(@"\b(?:no|not|without|avoid)\s+paus(?:e|es|ing)\b|(?<!rest-)(?<!rest )\bpaus(?:e|es|ing)\b[^.!?]{0,35}\b(?:between|after)\s+(?:the\s+)?sets?\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static bool Requested(string? name, string? notes)
        => Pause.IsMatch(name ?? "") || (!NotRepPause.IsMatch(notes ?? "") && Pause.IsMatch(notes ?? ""));

    public static Guid? Variant(Dictionary<string, Guid> library, string name)
    {
        var baseName = BaseName(name);
        if (baseName.Length == 0) return null;
        return CatalogMatching.FindWhole(library, $"Pause {baseName}")
            ?? CatalogMatching.FindWhole(library, $"Paused {baseName}");
    }

    public static string BaseName(string name)
    {
        var baseName = Regex.Replace(name, @"\bwith\s+pause(?:d|s|ing)?\b", " ", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return Regex.Replace(Pause.Replace(baseName, " "), @"\s+", " ").Trim();
    }

    public static bool LastOnly(string? description)
        => Regex.Split(description ?? "", @"(?<!\d)\.|\.(?!\d)|[!?;]").Any(sentence => Pause.IsMatch(sentence) &&
            Regex.IsMatch(sentence, @"\b(?:last|final)\s+(?:working\s+)?set\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant));

    public static List<DraftSet> MarkWorkingSets(List<DraftSet> sets, string? description)
    {
        var lastOnly = LastOnly(description);
        var last = sets.FindLastIndex(set => !set.Warmup);
        return sets.Select((set, index) => !lastOnly || index == last ? Mark(set) : set).ToList();
    }

    public static DraftSet Mark(DraftSet set)
    {
        if (set.Warmup || (set.Notes ?? "").Contains("Pause set", StringComparison.OrdinalIgnoreCase)) return set;
        var existing = ImportNormalization.Text(set.Notes, 388);
        var notes = existing is null ? "Pause set" : $"{existing} — Pause set";
        return set with { Notes = ImportNormalization.Text(notes, 400) };
    }
}
