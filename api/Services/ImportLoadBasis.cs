using System.Text.RegularExpressions;
using System.Globalization;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Carries source instructions needed to interpret a percentage after the draft becomes a workout.
internal static class ImportLoadBasis
{
    private static readonly Regex PriorSet = new(@"\b(?:top|previous|amrap)\s+set\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex Relative = new(@"(?<value>\d+(?:\.\d+)?)\s*%\s+of\b[^%.!?;]{0,100}\b(?:top|previous|amrap)\s+set\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex Opener = new(@"\bstart\s+(?:with|at)\s+100\s*%", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex PrescribedTop = new(@"\btop\s+set\b[^%.!?;]{0,25}\b\d+(?:\.\d+)?\s*%", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static List<SetPrescription> ApplyPrescriptions(List<SetPrescription> sets, string? coaching)
    {
        var instruction = coaching ?? "";
        var opener = Opener.IsMatch(instruction);
        var firstWorking = sets.FindIndex(set => !set.Warmup);
        var workingCount = sets.Count(set => !set.Warmup);
        var mixedLoads = sets.Where(set => !set.Warmup && PercentageLoad.Parse(set.LoadText) is not null).Select(set => set.LoadText).Distinct(StringComparer.OrdinalIgnoreCase).Skip(1).Any();
        return sets.Select((set, index) =>
        {
            if (set.Warmup || PercentageLoad.Parse(set.LoadText) is not { } band) return set;
            var note = IsRelative(instruction, set.LoadText, set.Notes, index == firstWorking, workingCount, mixedLoads) ? PercentageLoad.PriorSetNote
                : opener && index == firstWorking && band.Low == 100 ? "Start with 100%." : null;
            if (note is null || (set.Notes ?? "").Contains(note, StringComparison.OrdinalIgnoreCase)) return set;
            var existing = ImportNormalization.Text(set.Notes, 375);
            return set with { Notes = existing is null ? note : $"{existing} — {note}" };
        }).ToList();
    }

    public static List<DraftSet> Apply(List<DraftSet> sets, string? coaching)
    {
        var instruction = coaching ?? "";
        var opener = Opener.IsMatch(instruction);
        var firstWorking = sets.FindIndex(set => !set.Warmup);
        var workingCount = sets.Count(set => !set.Warmup);
        var mixedLoads = sets.Where(set => !set.Warmup && PercentageLoad.Parse(set.LoadText) is not null).Select(set => set.LoadText).Distinct(StringComparer.OrdinalIgnoreCase).Skip(1).Any();
        return sets.Select((set, index) =>
        {
            if (set.Warmup || PercentageLoad.Parse(set.LoadText) is not { } band) return set;
            if (IsRelative(instruction, set.LoadText, set.Notes, index == firstWorking, workingCount, mixedLoads))
            {
                if ((set.Notes ?? "").Contains(PercentageLoad.PriorSetNote, StringComparison.OrdinalIgnoreCase)) return set;
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

    private static bool IsRelative(string coaching, string? load, string? notes, bool first, int workingCount, bool mixedLoads)
    {
        var own = $"{load} {notes}";
        if (PriorSet.IsMatch(own) && Relative.IsMatch(own)) return true;
        if (first && workingCount > 1 && (mixedLoads || PrescribedTop.IsMatch(coaching))) return false;
        if (PercentageLoad.Parse(load) is not { } band) return false;
        return Relative.Matches(coaching).Any(match =>
            double.TryParse(match.Groups["value"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            && value >= band.Low && value <= band.High);
    }
}
