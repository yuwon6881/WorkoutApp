using System.Globalization;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Recovers explicit source-table values the model omitted. Rows are matched by their printed
/// movement name whenever possible; positional matching is reserved for one unambiguous table/day.
internal static partial class ImportTableEvidence
{
    private static readonly Regex Page = new(@"(?m)^=== PAGE (?<page>\d+) ===\s*$", RegexOptions.Compiled);
    private static readonly Regex Day = new(@"^(?:LOWER|UPPER)\s+\d+$|^ARMS\s*/\s*DELTS$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex SimpleReps = new(@"^(?<min>\d+)\s*(?:(?:[-–]|\bto\b)\s*(?<max>\d+))?\s*(?:reps?)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex RestValue = new(@"^(?:[~≈]\s*|\bapprox(?:\.|\b)\s*)?(?<min>\d+(?:\.\d+)?)\s*(?:[-–]\s*(?<max>\d+(?:\.\d+)?))?\s*(?<unit>min|mins|minutes?|sec|secs|seconds?|s|m)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Numeric = new(@"^\d+(?:\.\d+)?$", RegexOptions.Compiled);
    private static readonly Regex WorkingSetPrescription = new(@"^(?<min>\d{1,2})(?:\s*(?:[-–]\s*(?<max>\d{1,2})|\+(?=\s|$))|\s+or\s+(?<alternate>\d{1,2}))(?:\s+sets?)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex CombinedSetsAndReps = new(@"^(?:\(optional\)\s*)?(?<sets>\d{1,2})\s+(?<reps>\d{1,3})$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Percentage = new(@"\b\d+(?:\.\d+)?\s*(?:[-–]\s*\d+(?:\.\d+)?\s*)?%\s*(?:1\s*rm)?", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PageRestMinutes = new(@"\brest\b.{0,45}\b(?:minutes?|mins?)\b|\b(?:minutes?|mins?)\b.{0,45}\brest\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PageRestSeconds = new(@"\brest\b.{0,45}\b(?:seconds?|secs?)\b|\b(?:seconds?|secs?)\b.{0,45}\brest\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    // A table's own tallies: "SESSION SET VOLUME", "WEEKLY BICEP VOLUME", "TOTAL TRAINING TIME".
    private static readonly Regex TableSummary = new(@"^(?:(?:SESSION|TOTAL|WEEKLY)\s+(?:[A-Z]+\s+)?(?:SET\s+)?VOLUME|TOTAL\s+TRAINING\s+TIME)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    // Trailing volume summaries fused to exercise names across layout columns.
    private static readonly Regex TrailingVolume = new(@"\s+(?:\d+\s+)?(?:WEEKLY|SESSION|TOTAL)\s+.*VOLUME.*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    // "1-2 Rest Days", "SUGGESTED REST DAY (1-2 DAYS OFF …)": one band grammar for every reader.
    private static Regex RestDay => ImportLongWeeks.RestBand;
    /// A rep range, approximate RPE, rest time or percentage: what a row states and a header
    /// never prints. A bare integer is not enough, because tracking columns are headed "1 | 2 | 3".
    private static readonly Regex HeaderValue = new(@"^(?:[~≈]\s*\d.*|\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:min|mins|minutes?|sec|secs|seconds?|s|m|reps?)?|\d+(?:\.\d+)?\s*(?:min|mins|minutes?|sec|secs|seconds?|%)|\d+\.\d+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private const int MaxHeaderLength = 48;

    private sealed record EvidenceRow(string? ExerciseName, int? WorkingSets, string? RepsText, int? RepMin, int? RepMax,
        string? LoadText, string? RirText, double? Rir, List<RirEvidence> RirBySet,
        double? Rpe, double? EarlyRpe, double? LastRpe, string? RestText, int? RestSeconds, bool RestNotStated = false,
        bool WarmupCounted = true, bool EarlyEffortAbsent = false, bool LastEffortAbsent = false, bool RestStatedAbsent = false,
        bool NotPerformed = false, string? WarmupText = null, string? CoachingNote = null, string? DayLabel = null,
        bool FullHeader = false, string? SequenceGroup = null, List<string>? Substitutions = null, bool Prose = false,
        int Table = 0, string? Technique = null, string? Tempo = null, bool RepsStatedAbsent = false,
        string? WorkingSetPrescriptionText = null, bool WorkingSetsStatedAbsent = false);
    private sealed record RirEvidence(string? Text, double? Value);
    private sealed record EvidencePage(int? Week, string? Block, string? Phase, string? DayName, bool HasRestDayFooter,
        List<EvidenceRow> Rows, bool RestBandFollowsTable = false, string Body = "");
    private sealed record Columns(int? Name, int? Sets, int? Reps, int? Load, int? Rir, int?[] RirBySet,
        int? Rpe, int? EarlyRpe, int? LastRpe, int? Rest, string? RestUnit, bool LoadIsPercent1Rm,
        bool HasWarmup = false, int? Warmup = null, int? Notes = null, int[]? Substitutions = null, int? Technique = null, int? Tempo = null);

    public static AiProgram Enrich(AiProgram program, string sourceText)
    {
        var pages = Read(sourceText);
        if (pages.Count == 0 || program.Days is not { } days) return program;
        var enriched = days.Select((day, index) =>
        {
            var sourcePage = day.SourcePage ?? UniqueSourcePage(day.Exercises);
            if (sourcePage is not { } page || !pages.TryGetValue(page, out var evidence)) return day;
            var block = string.IsNullOrWhiteSpace(day.Block) ? evidence.Block : day.Block;
            var phase = string.IsNullOrWhiteSpace(day.Phase) ? evidence.Phase : day.Phase;
            var dayName = string.IsNullOrWhiteSpace(day.DayName) ? evidence.DayName ?? day.DayName : day.DayName;
            // A week printed on the day page is source evidence; the model's nonzero week is an
            // interpretation. Let chunk reconciliation translate phase-local printed numbering
            // into the program's absolute numbering afterwards.
            var week = evidence.Week ?? day.WeekNumber;
            var phaseWeek = day.PhaseWeek > 0 ? day.PhaseWeek : 1;
            var exercises = day.Exercises ?? [];
            var isRestDay = day.IsRestDay || (exercises.Count == 0 && evidence.HasRestDayFooter);
            if (day.IsRestDay)
                return day with { Block = block, Phase = phase, DayName = dayName,
                    WeekNumber = week, PhaseWeek = phaseWeek };
            // A rest day read from the same page is no second table to pair a row with.
            var positionalMatchIsSafe = TrainingDaysOn(days, page) == 1;
            var printed = PrintedRowsFor(exercises, dayName, evidence, TrainingDaysOn(days, page), TrainingDaysOn(days.Take(index), page));
            if (evidence.Rows.Count == 0 || exercises.Count == 0 && printed.Count == 0)
                return day with { Block = block, Phase = phase, DayName = dayName, WeekNumber = week, PhaseWeek = phaseWeek, IsRestDay = isRestDay };

            // A footer band can be mistaken for the day's flag, but a page that also has table
            // rows is a training page. Exact-name matches allow several workouts on one page.
            isRestDay = false;
            // A row printed with 0 sets and 0 reps is a movement that week leaves out; a read that
            // gave it a set invented one the page never prescribes. A nameless exercise no printed
            // row accounts for is not on the page either (Pure Bodybuilding Full Body p.7).
            var next = printed.Count > 0
                ? RecoverPrintedRows(exercises, printed, evidence, page, dayName, positionalMatchIsSafe)
                : exercises.Select((exercise, exerciseIndex) =>
                {
                    var row = MatchRow(exercise, exerciseIndex, exercises, evidence.Rows, positionalMatchIsSafe, dayName);
                    var source = row is null ? exercise : exercise with
                    {
                        Sets = NamesCorrespond(exercise.SourceName, row.ExerciseName)
                            ? exercise.Sets.Select(set => WithoutPrinted(set, row)).ToList()
                            : exercise.Sets
                    };
                    return (Row: row, Exercise: row is null ? exercise : Apply(source, row));
                }).Where(item => item.Row?.NotPerformed != true && (item.Row is not null || HasText(item.Exercise.SourceName)))
                .Select(item => item.Exercise).ToList();
            return day with { Block = block, Phase = phase, DayName = dayName, WeekNumber = week, PhaseWeek = phaseWeek,
                IsRestDay = isRestDay, Exercises = next };
        }).ToList();
        return program with { Days = WithFooterRestDays(WithMissingDays(enriched, pages), pages) };
    }

    private static EvidenceRow? MatchRow(AiExercise exercise, int exerciseIndex, List<AiExercise> dayExercises, List<EvidenceRow> rows,
        bool positionalMatchIsSafe, string? dayName = null)
    {
        var name = NormalizeName(exercise.SourceName);
        if (name.Length > 0)
        {
            var matches = rows.Where(row => NormalizeName(row.ExerciseName ?? "") == name).ToList();
            // A page that prints a whole week (Forearm Hypertrophy: Day 1, Day 2, Day 3) repeats a
            // movement under several day labels; the row under this day's own label is its row.
            var labelled = dayName is null ? [] : matches.Where(row => row.DayLabel is { } label
                && NormalizeName(label) == NormalizeName(dayName)).ToList();
            if (labelled.Count > 0) matches = labelled;
            if (matches.Count == 1) return matches[0];
            if (matches.Count > 1)
            {
                // A movement printed on several rows ("Overhead Press (Warm Up)" at two loads) pairs
                // with them in order, when the read kept the same number of rows by that name.
                var total = dayExercises.Count(other => NormalizeName(other.SourceName) == name);
                var before = dayExercises.Take(exerciseIndex).Count(other => NormalizeName(other.SourceName) == name);
                return total == matches.Count ? matches[before] : null;
            }
            // A read can drop a printed qualifier ("Weak Point Exercise 2" for "... 2 (optional)"),
            // which split one movement into two slots. The printed row still names it uniquely.
            var bare = NormalizeName(WithoutBrackets(exercise.SourceName));
            var qualified = bare.Length == 0 ? [] : rows.Where(row => NormalizeName(WithoutBrackets(row.ExerciseName ?? "")) == bare).Take(2).ToList();
            if (qualified.Count == 1) return qualified[0];
        }
        if (!positionalMatchIsSafe || rows.Count != dayExercises.Count)
            return null;
        return exerciseIndex >= 0 && exerciseIndex < rows.Count ? rows[exerciseIndex] : null;
    }

    private static string WithoutBrackets(string value) => Regex.Replace(value, @"\([^()]*\)|\[[^\[\]]*\]", " ");

    /// Whether the cells a set reads its effort from are empty. An early- or last-set column is
    /// that set's own; otherwise every RPE and RIR column on the row speaks for it.
    private static bool EffortAbsent(string[] cells, Columns map, int? ownColumn)
        => (ownColumn is not null ? new[] { ownColumn } : new[] { map.Rpe, map.Rir }.Concat(map.RirBySet).ToArray())
            .Where(column => column is not null).All(column => NoValue(Cell(cells, column)));

    private static bool IsZero(string? value) => value?.Trim() == "0";

    private static bool NoValue(string? value) => string.IsNullOrWhiteSpace(value) || IsStatedAbsent(value)
        // "See Notes" points to a different printed field; AMRAP is a value when it appears in
        // a technique column and must survive as the last set's technique.
        || Regex.IsMatch(value.Trim(), @"^(?:see\s+)?notes?$", RegexOptions.IgnoreCase);

    private static bool IsStatedAbsent(string? value)
        => value is not null && Regex.IsMatch(value.Trim(), @"^(?:N/?A|[-–—])$", RegexOptions.IgnoreCase);

    private static string NormalizeName(string value)
    {
        var clean = ImportSetTags.Strip(value);
        return Regex.Replace(clean, @"[^\p{L}\p{N}]", "").ToLowerInvariant();
    }

    private static int? UniqueSourcePage(List<AiExercise> exercises)
    {
        var pages = exercises.SelectMany(exercise => new int?[] { exercise.SourcePage }
                .Concat(exercise.Sets.Select(set => set.SourcePage)))
            .Where(page => page.HasValue).Select(page => page.GetValueOrDefault()).Distinct().Take(2).ToList();
        return pages.Count == 1 ? pages[0] : null;
    }

    private static AiExercise Apply(AiExercise exercise, EvidenceRow evidence)
    {
        var sets = exercise.Sets?.ToList() ?? [];
        var existingCount = PositiveSetCount(exercise.WorkingSets);
        var required = evidence.WorkingSets ?? existingCount;
        if (required is > 0 && sets.Count > 0)
        {
            while (sets.Count < required.Value)
            {
                var seed = sets[^1];
                sets.Add(seed with { RepsSource = "inferred", RpeSource = "inferred", RestSource = "inferred" });
            }
            if (sets.Count > required.Value)
                sets = sets.Take(required.Value).ToList();
        }
        else if (required is > 0)
        {
            sets = Enumerable.Range(0, required.Value)
                .Select(_ => new AiSet(1, 1, null, null, null, null, null,
                    RepsSource: "inferred", RpeSource: "inferred", RestSource: "inferred"))
                .ToList();
        }

        var repaired = sets.Select((set, index) => ApplySet(set, evidence, index, sets.Count)).ToList();
        var coachingNotes = evidence.CoachingNote ?? exercise.CoachingNotes;
        if (HasText(evidence.WorkingSetPrescriptionText)
            && !Regex.IsMatch(coachingNotes ?? "", @"\bprinted working-set prescription\s*:", RegexOptions.IgnoreCase))
        {
            var printedRange = $"Printed working-set prescription: {evidence.WorkingSetPrescriptionText}.";
            coachingNotes = HasText(coachingNotes) ? $"{coachingNotes!.Trim()} {printedRange}" : printedRange;
        }
        return exercise with
        {
            SourceName = HasText(evidence.ExerciseName) ? evidence.ExerciseName! : exercise.SourceName,
            WorkingSets = evidence.WorkingSets is { } stated
                ? stated.ToString(CultureInfo.InvariantCulture) : exercise.WorkingSets,
            // A table with no warm-up column states no warm-up count; one the read supplied was
            // taken from a row's own set count and added sets the page never prints.
            WarmupSets = evidence.WarmupCounted ? exercise.WarmupSets : null,
            CoachingNotes = coachingNotes,
            Sets = repaired
        };
    }

    private static int? PositiveSetCount(string? value)
        => int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var count) && count > 0 ? count : null;

    private static AiSet ApplySet(AiSet set, EvidenceRow evidence, int index, int count)
    {
        var last = index == count - 1;
        var setRir = index < evidence.RirBySet.Count ? evidence.RirBySet[index] : null;
        var rirText = setRir?.Text ?? evidence.RirText;
        var rir = setRir?.Text is not null ? setRir.Value : evidence.Rir;
        var inferredFromRir = rir is { } rirValue && rirValue is >= 0 and <= 4 ? 10 - Math.Round(rirValue, MidpointRounding.AwayFromZero) : (double?)null;
        var sourceRpe = last ? evidence.LastRpe ?? evidence.EarlyRpe ?? evidence.Rpe : evidence.EarlyRpe ?? evidence.Rpe;
        if (sourceRpe is { } sRpe) sourceRpe = Math.Round(sRpe, MidpointRounding.AwayFromZero);
        var usableSourceRpe = sourceRpe is >= 6 and <= 10 ? sourceRpe : null;
        var targetRpe = rirText?.Equals("N/A", StringComparison.OrdinalIgnoreCase) == true && index > 0 && set.RpeSource == "inferred"
            ? null : set.TargetRpe ?? inferredFromRir ?? usableSourceRpe;
        if (targetRpe is { } tRpe) targetRpe = Math.Round(tRpe, MidpointRounding.AwayFromZero);
        var rpeSource = set.TargetRpe is null
            ? inferredFromRir is not null ? "inferred" : sourceRpe is not null ? "extracted" : set.RpeSource
            : set.RpeSource;

        var resolvedRir = rirText?.Equals("N/A", StringComparison.OrdinalIgnoreCase) == true
            ? "N/A"
            : HasText(set.Rir)
                ? (double.TryParse(set.Rir, NumberStyles.Float, CultureInfo.InvariantCulture, out var sRir) ? ((int)Math.Round(sRir)).ToString(CultureInfo.InvariantCulture) : set.Rir)
                : HasText(rirText)
                    ? (double.TryParse(rirText, NumberStyles.Float, CultureInfo.InvariantCulture, out var eRir) ? ((int)Math.Round(eRir)).ToString(CultureInfo.InvariantCulture) : rirText)
                    : sourceRpe is { } lowSourceRpe && lowSourceRpe is >= 5 and < 6
                        ? ((int)Math.Round(10 - lowSourceRpe, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture)
                        : targetRpe is { } tVal && tVal is >= 6 and <= 10
                        ? ((int)Math.Round(10 - tVal)).ToString(CultureInfo.InvariantCulture)
                        : null;

        // A rest cell that reads "N/A" states that the row prescribes none. A time the model supplied
        // there came from somewhere else in the document, and would enter the program as printed.
        if (evidence.RestNotStated) set = set with { RestText = null, RestSeconds = null, RestSource = "extracted" };
        // A target left empty is the page's own statement only when its cell is blank, "-" or N/A.
        // Anything else in that cell was printed and not read, and review must say so.
        if (targetRpe is null && !Regex.IsMatch(resolvedRir ?? "", @"\d"))
            rpeSource = (last ? evidence.LastEffortAbsent : evidence.EarlyEffortAbsent) ? "extracted" : "inferred";
        var restText = HasText(set.RestText) ? set.RestText : evidence.RestText;
        var restSeconds = set.RestSeconds ?? evidence.RestSeconds ?? ParseRestSeconds(restText);
        var repsText = HasText(set.RepsText) ? set.RepsText : evidence.RepsText;
        var hasModelRepBounds = set.RepMin > 0 && set.RepMax >= set.RepMin
            && (set.RepMin != 1 || set.RepMax != 1 || HasText(set.RepsText)
                || evidence.RepMin == 1 && evidence.RepMax == 1);
        (int? Min, int? Max) reps = hasModelRepBounds
            ? (set.RepMin, set.RepMax)
            : evidence.RepMin is { } min && evidence.RepMax is { } max ? (min, max) : (set.RepMin, set.RepMax);
        // The printed cell is blank, "-" or N/A: the page sets no rep target, whatever the read guessed.
        if (evidence.RepsStatedAbsent && !HasText(set.RepsText)) reps = (null, null);
        var (repMin, repMax) = reps;
        return set with
        {
            RepMin = repMin,
            RepMax = repMax,
            RepsText = repsText,
            RepsSource = !HasText(set.RepsText) && HasText(evidence.RepsText) ? "extracted" : set.RepsSource,
            LoadText = HasText(set.LoadText) ? set.LoadText : evidence.LoadText,
            Tempo = HasText(set.Tempo) ? set.Tempo : evidence.Tempo,
            Notes = last && !HasText(set.Notes) ? evidence.Technique ?? set.Notes : set.Notes,
            TargetRpe = targetRpe,
            Rir = resolvedRir,
            RpeSource = rpeSource,
            RestText = restText,
            RestSeconds = restSeconds,
            RestSource = restSeconds is null && !HasText(restText)
                ? evidence.RestStatedAbsent || evidence.RestNotStated ? "extracted" : "inferred"
                : set.RestSeconds is null && (evidence.RestSeconds is not null || HasText(evidence.RestText)) ? "extracted" : set.RestSource
        };
    }
}
