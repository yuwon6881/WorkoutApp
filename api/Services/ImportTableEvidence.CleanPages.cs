using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Where the reader rebuilt a clean table, the printed rows decide a day's exercises, their order,
/// set counts and every value a row prints. A read adds, drops and retypes things a page states
/// plainly (a nameless row, a dropped last exercise, a title-cased name, an invented rest), so on
/// those pages the read only contributes what a table cannot say: catalog ids, notes, and a
/// substitution or superset tag the row leaves out.
internal static partial class ImportTableEvidence
{
    /// A name shorter than this letter run is too common to prove a page prints it outside a row.
    private const int MinPrintedNameLength = 6;

    /// A running footer ("JEFF NIPPARD | BACK HYPERTROPHY PROGRAM | 7") drops its page number into
    /// a set or rep column: words, then one bare number, and nothing a set prescribes.
    private static bool IsRunningFooter(string[] cells, EvidenceRow row)
    {
        var filled = cells.Where(HasText).Select(cell => cell.Trim()).ToList();
        return filled.Count is >= 2 and <= 3 && Regex.IsMatch(filled[^1], @"^\d{1,3}$")
            && filled.SkipLast(1).All(cell => !cell.Any(char.IsDigit))
            && row.RestText is null && row.LoadText is null && row.Rpe is null && row.RirText is null;
    }

    /// A line of prose under a header ("Mandatory 1-2 Rest Days", a coaching sentence, a running
    /// footer) reads as a row with a name and nothing else; it is not one of the table's rows.
    private static List<EvidenceRow> TableRows(EvidencePage page) => page.Rows.Where(row => !row.Prose).ToList();

    /// Every row was read against a header naming its exercise, set and rep columns, and every row
    /// states a name, a working-set count (or prints zero sets as left out) and its reps.
    private static bool IsUsableRow(EvidenceRow row)
        => row.FullHeader && HasText(row.ExerciseName)
            && !TableSummary.IsMatch(row.ExerciseName!.Trim())
            && (row.NotPerformed
                || row.WorkingSets is > 0 && (HasText(row.RepsText) || row.RepsStatedAbsent)
                || row.WorkingSetsStatedAbsent && HasText(row.RepsText));

    private static bool IsClean(IReadOnlyCollection<EvidenceRow> rows)
        => rows.Count > 0 && rows.All(IsUsableRow);

    private static bool IsClean(EvidencePage page) => IsClean(TableRows(page));

    /// The rows one day owns: all of them when it is the page's only day and the page prints at
    /// most one day label, otherwise those under its own label. They must sit under one header: a
    /// second header under the same label is another day whose title is printed in the table's
    /// side column (Powerbuilding System's "LOWER # 2"). None means the read is kept.
    /// When labels do not settle it and the page holds as many tables as the read has days on it,
    /// the page's days and tables pair in order.
    private static List<EvidenceRow> RowsFor(string? dayName, EvidencePage page, int daysOnPage, int dayIndex)
    {
        var rows = TableRows(page);
        var labels = rows.Select(row => row.DayLabel is { } label ? NormalizeName(label) : null).Distinct().ToList();
        List<EvidenceRow> owned = [];
        if (daysOnPage == 1 && labels.Count(label => label is not null) <= 1) owned = rows;
        else if (!labels.Contains(null) && !string.IsNullOrWhiteSpace(dayName))
            owned = rows.Where(row => NormalizeName(row.DayLabel!) == NormalizeName(dayName)).ToList();
        if (owned.Count > 0 && owned.Select(row => row.Table).Distinct().Count() == 1) return owned;
        var tables = rows.GroupBy(row => row.Table).Select(table => table.ToList()).ToList();
        return tables.Count == daysOnPage && dayIndex >= 0 && dayIndex < tables.Count ? tables[dayIndex] : [];
    }

    /// A day's printed rows, when its page is clean and the read is of that page: at least half of
    /// the movements the read names are printed there. A read that names none of them cited the
    /// wrong page or fused its rows, and pairing it with this table would guess.
    private static List<EvidenceRow> PrintedRowsFor(List<AiExercise> extracted, string? dayName, EvidencePage page, int daysOnPage, int dayIndex)
    {
        var rows = RowsFor(dayName, page, daysOnPage, dayIndex).Where(IsUsableRow).ToList();
        if (rows.Count == 0) return [];
        var printed = rows.SelectMany(row => new[] { NormalizeName(row.ExerciseName!), NormalizeName(WithoutBrackets(row.ExerciseName!)) }).ToHashSet();
        var named = extracted.Where(exercise => HasText(exercise.SourceName)).ToList();
        var found = named.Count(exercise => printed.Contains(NormalizeName(exercise.SourceName))
            || printed.Contains(NormalizeName(WithoutBrackets(exercise.SourceName)))
            || IsFusedNameOfAdjacentRows(exercise.SourceName, rows));
        return found * 2 >= named.Count ? rows : [];
    }

    private static bool IsFusedNameOfAdjacentRows(string sourceName, IReadOnlyList<EvidenceRow> rows)
    {
        var withoutGroup = Regex.Replace(sourceName, @"\s+[A-Z]\d{1,2}\s*:\s*", " ", RegexOptions.IgnoreCase);
        var composite = NormalizeName(withoutGroup);
        for (var index = 0; index + 1 < rows.Count; index++)
        {
            var first = NormalizeName(rows[index].ExerciseName ?? "");
            var second = NormalizeName(rows[index + 1].ExerciseName ?? "");
            if (first.Length > 0 && second.Length > 0 && first + second == composite) return true;
        }
        return false;
    }

    /// Rebuilds a day from its printed rows. Each row keeps the read's exercise when one matches it
    /// by name (paired by day label or in order when a name repeats), so its catalog id, notes and
    /// substitutions survive; the row's own values replace whatever the read put in their place.
    /// A read exercise no row accounts for stays only when it cites another page (a table that runs
    /// on) or when this page prints its name outside the rows the reader rebuilt.
    private static List<AiExercise> RecoverPrintedRows(List<AiExercise> extracted, List<EvidenceRow> rows, EvidencePage page,
        int pageNumber, string? dayName, bool positionalMatchIsSafe)
    {
        var matched = new Dictionary<EvidenceRow, AiExercise>(ReferenceEqualityComparer.Instance);
        var used = new HashSet<int>();
        for (var index = 0; index < extracted.Count; index++)
        {
            if (MatchRow(extracted[index], index, extracted, rows, positionalMatchIsSafe, dayName) is not { } row
                || matched.ContainsKey(row)) continue;
            matched[row] = extracted[index];
            used.Add(index);
        }

        var result = new List<AiExercise>();
        foreach (var row in rows.Where(row => !row.NotPerformed))
        {
            var previous = matched.GetValueOrDefault(row);
            var (seedMin, seedMax) = LeadingReps(row.RepsText);
            var seed = new AiSet(seedMin, seedMax, null, null, null, null, null,
                RepsSource: "inferred", RpeSource: "inferred", RestSource: "inferred", SourcePage: pageNumber);
            var source = previous is null
                ? new AiExercise(row.ExerciseName!, null, null, [seed], SourcePage: pageNumber)
                : previous with { Sets = NamesCorrespond(previous.SourceName, row.ExerciseName)
                    ? previous.Sets is { Count: > 0 } sets ? sets.Select(set => WithoutPrinted(set, row)).ToList() : [seed]
                    : previous.Sets };
            result.Add(Apply(source with
            {
                SequenceGroup = HasText(source.SequenceGroup) ? source.SequenceGroup : row.SequenceGroup,
                WarmupSets = source.WarmupSets ?? row.WarmupText,
                Substitutions = source.Substitutions is { Count: > 0 } ? source.Substitutions : row.Substitutions,
                SourcePage = source.SourcePage ?? pageNumber
            }, row));
        }

        var printedSubstitutions = rows.SelectMany(row => row.Substitutions ?? []).Select(NormalizeName).ToHashSet();
        // Row names are taken out first: a read that shortened a row's name is that row, not a second movement.
        var body = rows.Aggregate(NormalizeName(page.Body), (text, row) => text.Replace(NormalizeName(row.ExerciseName ?? ""), " "));
        foreach (var (exercise, index) in extracted.Select((exercise, index) => (exercise, index)))
        {
            if (used.Contains(index) || !HasText(exercise.SourceName)) continue;
            var otherPage = exercise.SourcePage is { } cited && cited != pageNumber;
            var name = NormalizeName(exercise.SourceName);
            var remainsInBody = name.Length >= MinPrintedNameLength
                && body.Contains(name, StringComparison.Ordinal) && !printedSubstitutions.Contains(name);
            if (!otherPage && !remainsInBody) continue;

            // A row can be too malformed to replace an entire table, but still print a clear
            // prescription for an exact movement match. Apply those cells without positional
            // guesses so one bad row does not preserve a drifting rest or effort value.
            var partialRow = otherPage ? null : MatchRow(exercise, index, extracted, TableRows(page),
                positionalMatchIsSafe: false, dayName);
            var recovered = exercise;
            if (partialRow is not null && NamesCorrespond(exercise.SourceName, partialRow.ExerciseName))
                recovered = Apply(exercise with { Sets = exercise.Sets.Select(set => WithoutPrinted(set, partialRow)).ToList() }, partialRow);
            result.Add(recovered);
        }
        return result;
    }

    /// Clears what the row prints, so the printed value is the one applied rather than the read's.
    private static AiSet WithoutPrinted(AiSet set, EvidenceRow row)
    {
        var effortPrinted = row.Rpe is not null || row.EarlyRpe is not null || row.LastRpe is not null
            || row.Rir is not null || row.RirBySet.Any(value => value.Value is not null);
        return set with
        {
            RepsText = row.RepsText is null ? set.RepsText : null,
            RepMin = row.RepMin is null ? set.RepMin : 0,
            RepMax = row.RepMax is null ? set.RepMax : 0,
            LoadText = row.LoadText is null ? set.LoadText : null,
            TargetRpe = effortPrinted ? null : set.TargetRpe,
            Rir = effortPrinted ? null : set.Rir,
            RestText = row.RestText is null ? set.RestText : null,
            RestSeconds = row.RestText is null ? set.RestSeconds : null
        };
    }

    private static bool NamesCorrespond(string? extracted, string? printed)
    {
        if (!HasText(extracted) || !HasText(printed)) return false;
        var left = NormalizeName(extracted!);
        var right = NormalizeName(printed!);
        return left == right || NormalizeName(WithoutBrackets(extracted!)) == NormalizeName(WithoutBrackets(printed!));
    }

    /// Reps a row prints as more than a plain range ("30 sec", "10+5", "8 + 8") still lead with the
    /// count to aim for; the printed text stays with the set.
    private static (int Min, int Max) LeadingReps(string? repsText)
    {
        var match = Regex.Match(repsText ?? "", @"(?<min>\d+)(?:\s*[-–]\s*(?<max>\d+))?");
        if (!match.Success || !int.TryParse(match.Groups["min"].Value, out var min) || min == 0) return (1, 1);
        var max = match.Groups["max"].Success && int.TryParse(match.Groups["max"].Value, out var upper) && upper >= min ? upper : min;
        return (min, max);
    }

    /// The printed option cells a row offers in place of its movement.
    private static List<string>? PrintedSubstitutions(string[] cells, Columns map)
    {
        var options = (map.Substitutions ?? []).Select(column => Cell(cells, column)?.Trim())
            .Where(value => IsMovementName(value) && !NoValue(value)).Select(value => value!).ToList();
        return options.Count > 0 ? options : null;
    }

    /// "A1." or "Superset B2:" before a movement is its superset tag.
    private static string? PrintedSetTag(string? name) => ImportSetTags.Find(name);

    /// How many training days the draft took from clean printed tables, for the review notice.
    public static int PrintedRowDays(IReadOnlyList<DraftWorkout> workouts, string sourceText)
    {
        var pages = Read(sourceText);
        var training = workouts.Where(day => !day.IsRestDay && day.SourcePage.HasValue).ToList();
        return training.Where((day, index) => pages.TryGetValue(day.SourcePage!.Value, out var evidence)
            && RowsFor(day.Name, evidence, training.Count(other => other.SourcePage == day.SourcePage),
                training.Take(index).Count(other => other.SourcePage == day.SourcePage)).Any(IsUsableRow)).Count();
    }

    /// How many training days the read places on a page, rest days aside.
    private static int TrainingDaysOn(IEnumerable<AiDay> days, int page)
        => days.Count(day => !day.IsRestDay && (day.SourcePage ?? UniqueSourcePage(day.Exercises)) == page);

    public static ImportReviewIssue? PrintedRowsNotice(IReadOnlyList<DraftWorkout> workouts, string sourceText)
        => PrintedRowDays(workouts, sourceText) is var count and > 0
            ? new ImportReviewIssue("printed_rows_used",
                $"{count} day{(count == 1 ? " was" : "s were")} read straight from {(count == 1 ? "its" : "their")} printed table{(count == 1 ? "" : "s")}.", "info")
            : null;
}
