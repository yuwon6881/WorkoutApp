using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// What kind of set a printed row describes, beyond its numbers. A row whose reps read "AMRAP"
/// has no rep target, so the technique tag is what tells review and logging to go to failure. A
/// row the table itself names a warm-up
/// ("Overhead Press (Warm Up)") is the warm-up, not a movement to warm up for.
internal static class ImportSetKinds
{
    /// The tag the review's set-type control reads (web/src/lib/importSetTypes.ts).
    public const string AmrapNote = "To failure / AMRAP";

    private static readonly Regex OpenReps = new(@"\b(?:amrap|max(?:imum)?\s+reps?|to\s+failure|failure)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex AlreadyTagged = new(@"amrap|failure", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex WarmupQualifier = new(@"(?:\(|\[|[-–—:]\s*)\s*warm[\s-]?ups?(?:\s+sets?)?\s*[\)\]]?\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static bool IsWarmupRow(string? name) => !string.IsNullOrWhiteSpace(name) && WarmupQualifier.IsMatch(name.Trim());

    /// A set whose printed reps are "as many as possible" carries the AMRAP tag.
    public static DraftSet Tagged(DraftSet set)
    {
        if (string.IsNullOrWhiteSpace(set.RepsText) || !OpenReps.IsMatch(set.RepsText)) return set;
        if (set.Notes is { } notes && AlreadyTagged.IsMatch(notes)) return set;
        var tagged = string.IsNullOrWhiteSpace(set.Notes) ? AmrapNote : $"{set.Notes.Trim()} — {AmrapNote}";
        return set with { Notes = ImportNormalization.Text(tagged, 400) };
    }

    /// A copy made to reach a row's stated set count. Its values are this app's expansion, but a
    /// value the page states it leaves blank stays the page's statement rather than a guess.
    public static DraftSet Repeated(DraftSet set) => set with
    {
        RepsSource = "inferred",
        RpeSource = set.TargetRpe is null ? set.RpeSource : "inferred",
        RestSource = set.RestSeconds is null ? set.RestSource : "inferred"
    };

    private static readonly Regex RepList = new(@"^\s*\d{1,3}(?:\s*,\s*\d{1,3}){1,9}\s*$", RegexOptions.Compiled);

    /// A reverse pyramid prints one rep target per working set in one cell ("4, 6, 8"). When the
    /// list has exactly one value per working set, each set takes its own; otherwise ("5, 15"
    /// inside a single set) the row is left as printed.
    public static List<DraftSet> PerSetReps(List<DraftSet> working)
    {
        if (working.Count < 2 || working[0].RepsText is not { } text || !RepList.IsMatch(text)
            || working.Any(set => set.RepsText != text)) return working;
        var values = text.Split(',').Select(value => int.Parse(value.Trim(), System.Globalization.CultureInfo.InvariantCulture)).ToList();
        if (values.Count != working.Count) return working;
        return working.Select((set, index) => set with
        {
            RepMin = values[index], RepMax = values[index],
            RepsText = values[index].ToString(System.Globalization.CultureInfo.InvariantCulture),
            RepsSource = "extracted"
        }).ToList();
    }

    /// The sets one printed row becomes. A warm-up row's own sets are its warm-ups, and nothing is
    /// added in front of them. Otherwise a stated warm-up count is modelled on the first working set.
    public static List<DraftSet> Compose(List<DraftSet> working, int warmups, string? rowName)
    {
        if (IsWarmupRow(rowName))
            // Warm-ups in this app carry no effort target; the printed load stays in loadText.
            return working.Select(set => set with { Warmup = true, TargetRpe = null, Rir = null }).ToList();
        // A movement can be listed with no prescription at all, and then there is nothing
        // for a warm-up to be modelled on. The exercise is given its one set further on.
        if (warmups <= 0 || working.Count == 0) return working;
        // The table's RPE columns prescribe working sets. Warm-up Sets is only a count, so
        // inheriting the working row's effort invents a warm-up target.
        // Nor is the working load or technique a warm-up's: "AMRAP @90%" or "12-15 (dropset)"
        // describes the hard set. Only the plain rep count the working set starts from is kept.
        var warmup = working[0] with
        {
            Warmup = true, TargetRpe = null, Rir = null, Notes = null, LoadText = null,
            RepsText = PlainReps(working[0].RepsText),
            RepsSource = "inferred", RpeSource = "inferred"
        };
        return [.. Enumerable.Repeat(warmup, warmups), .. working];
    }

    private static readonly Regex LeadingReps = new(@"^\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)(?=\s|$)", RegexOptions.Compiled);

    private static string? PlainReps(string? repsText)
    {
        if (string.IsNullOrWhiteSpace(repsText) || OpenReps.IsMatch(repsText)) return null;
        var match = LeadingReps.Match(repsText);
        return match.Success ? Regex.Replace(match.Groups[1].Value, @"\s+", "") : null;
    }
}
