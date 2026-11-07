using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Carries source instructions needed to interpret a percentage after the draft becomes a workout.
internal static class ImportLoadBasis
{
    private static readonly Regex PriorSet = new(@"\b(?:top|previous|amrap)\s+set\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex Relative = new(@"(?:%\s+of|(?:use|using)\s+~?\s*\d+(?:\.\d+)?\s*%)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex Opener = new(@"\bstart\s+(?:with|at)\s+100\s*%", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static List<SetPrescription> ApplyPrescriptions(List<SetPrescription> sets, string? coaching)
    {
        var instruction = coaching ?? "";
        var relative = PriorSet.IsMatch(instruction) && Relative.IsMatch(instruction);
        var opener = Opener.IsMatch(instruction);
        var firstWorking = sets.FindIndex(set => !set.Warmup);
        return sets.Select((set, index) =>
        {
            if (set.Warmup || PercentageLoad.Parse(set.LoadText) is not { } band) return set;
            var note = relative ? PercentageLoad.PriorSetNote
                : opener && index == firstWorking && band.Low == 100 ? "Start with 100%." : null;
            if (note is null || (set.Notes ?? "").Contains(note, StringComparison.OrdinalIgnoreCase)) return set;
            var existing = ImportNormalization.Text(set.Notes, 375);
            return set with { Notes = existing is null ? note : $"{existing} — {note}" };
        }).ToList();
    }

    public static List<DraftSet> Apply(List<DraftSet> sets, string? coaching)
    {
        var instruction = coaching ?? "";
        var relative = PriorSet.IsMatch(instruction) && Relative.IsMatch(instruction);
        var opener = Opener.IsMatch(instruction);
        var firstWorking = sets.FindIndex(set => !set.Warmup);
        return sets.Select((set, index) =>
        {
            if (set.Warmup || PercentageLoad.Parse(set.LoadText) is not { } band) return set;
            if (relative)
            {
                var prior = string.IsNullOrWhiteSpace(set.Notes) ? PercentageLoad.PriorSetNote : $"{set.Notes} — {PercentageLoad.PriorSetNote}";
                return set with { Notes = ImportNormalization.Text(prior, 400) };
            }
            if (opener && index == firstWorking && band.Low == 100)
            {
                var notes = string.IsNullOrWhiteSpace(set.Notes) ? "Start with 100%." : $"{set.Notes} — Start with 100%.";
                return set with { Notes = ImportNormalization.Text(notes, 400) };
            }
            return set;
        }).ToList();
    }
}
