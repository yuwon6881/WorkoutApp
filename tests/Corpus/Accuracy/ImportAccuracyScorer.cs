using System.Text;
using Workout.Api.Services;

namespace Workout.Tests.Corpus.Accuracy;

public sealed record FieldTally(int Matched, int Total)
{
    public double? Rate => Total == 0 ? null : (double)Matched / Total;
}

/// One candidate draft measured against a hand-checked gold draft. Every count is traceable to an
/// entry in <see cref="Differences"/>; nothing here is a model of how the document "should" read.
public sealed record AccuracyScore(
    int GoldDays, int MatchedDays, int MissingDays, int ExtraDays,
    int GoldExercises, int MatchedExercises, int MissingExercises, int ExtraExercises,
    int GoldSets, int MissingSets, int ExtraSets,
    IReadOnlyDictionary<string, FieldTally> Fields,
    int CorrectionEdits,
    IReadOnlyList<string> Differences)
{
    /// Matched gold fields over every gold field, so an omitted day or exercise lowers it.
    public double FieldAccuracy
    {
        get
        {
            var total = Fields.Values.Sum(tally => tally.Total);
            return total == 0 ? 0 : (double)Fields.Values.Sum(tally => tally.Matched) / total;
        }
    }
}

public static class ImportAccuracyScorer
{
    public static readonly string[] FieldNames =
    [
        "dayRest", "sets.count", "repMin", "repMax", "rpe", "rir", "rest", "tempo", "load", "warmup",
        "notes", "superset", "substitutions", "demoLinks", "alternatives"
    ];

    private const int MaxDifferences = 200;

    /// Days and exercises are aligned by longest common subsequence of their normalised names, so one
    /// omitted or invented row does not shift every row after it into a false mismatch.
    ///
    /// Programs with alternatives are scored after one option per group has been chosen, because the old
    /// importer's draft only ever holds the chosen days. <paramref name="goldOffered"/> and
    /// <paramref name="candidateOffered"/> are the drafts before that choice; the offered options are compared
    /// from them. A candidate with no offered draft (the old importer's) is not scored on options at all, and
    /// the score says so instead of counting every option as missing.
    public static AccuracyScore Score(ImportDraft gold, ImportDraft candidate,
        ImportDraft? goldOffered = null, ImportDraft? candidateOffered = null)
    {
        if (gold.Workouts.Count == 0) throw new ArgumentException("The gold draft has no days to score against.", nameof(gold));
        var run = new Run();

        var days = Align(gold.Workouts.Select(DayKey).ToList(), candidate.Workouts.Select(DayKey).ToList());
        var matchedGold = days.Select(pair => pair.Gold).ToHashSet();
        var matchedCandidate = days.Select(pair => pair.Candidate).ToHashSet();

        foreach (var (goldIndex, candidateIndex) in days)
            ScoreDay(gold.Workouts[goldIndex], candidate.Workouts[candidateIndex], run);

        for (var i = 0; i < gold.Workouts.Count; i++)
        {
            if (matchedGold.Contains(i)) continue;
            run.MissingDays++;
            run.Edits++;
            run.Note($"Missing day: week {gold.Workouts[i].Week} \"{gold.Workouts[i].Name}\".");
            run.Tally("dayRest", false);
            foreach (var exercise in gold.Workouts[i].Exercises)
            {
                run.MissingExercises++;
                run.Edits++;
                run.GoldExercises++;
                TallyUnmatched(exercise, run);
            }
        }
        for (var i = 0; i < candidate.Workouts.Count; i++)
        {
            if (matchedCandidate.Contains(i)) continue;
            // Removing an invented day is one action however many exercises it holds.
            run.ExtraDays++;
            run.Edits++;
            run.Note($"Extra day: week {candidate.Workouts[i].Week} \"{candidate.Workouts[i].Name}\".");
        }

        if (goldOffered is not null && candidateOffered is null)
        {
            if (goldOffered.AlternativeGroups is { Count: > 0 })
                run.Note("Alternatives were not scored: this draft no longer holds the options that were not chosen.");
        }
        else ScoreAlternatives(goldOffered ?? gold, candidateOffered ?? candidate, run);
        return run.Build(gold.Workouts.Count, days.Count);
    }

    private static void ScoreDay(DraftWorkout gold, DraftWorkout candidate, Run run)
    {
        var label = $"week {gold.Week} \"{gold.Name}\"";
        run.MatchedDays++;
        run.TallyEdit("dayRest", gold.IsRestDay == candidate.IsRestDay, $"{label}: rest day flag differs.");

        var exercises = Align(gold.Exercises.Select(e => Norm(e.SourceName)).ToList(),
            candidate.Exercises.Select(e => Norm(e.SourceName)).ToList());
        var matchedGold = exercises.Select(pair => pair.Gold).ToHashSet();
        var matchedCandidate = exercises.Select(pair => pair.Candidate).ToHashSet();
        run.GoldExercises += gold.Exercises.Count;

        foreach (var (goldIndex, candidateIndex) in exercises)
        {
            run.MatchedExercises++;
            ScoreExercise(gold.Exercises[goldIndex], Partners(gold.Exercises, goldIndex),
                candidate.Exercises[candidateIndex], Partners(candidate.Exercises, candidateIndex), label, run);
        }
        for (var i = 0; i < gold.Exercises.Count; i++)
        {
            if (matchedGold.Contains(i)) continue;
            run.MissingExercises++;
            run.Edits++;
            run.Note($"{label}: missing exercise \"{gold.Exercises[i].SourceName}\".");
            TallyUnmatched(gold.Exercises[i], run);
        }
        for (var i = 0; i < candidate.Exercises.Count; i++)
        {
            if (matchedCandidate.Contains(i)) continue;
            run.ExtraExercises++;
            run.Edits++;
            run.Note($"{label}: extra exercise \"{candidate.Exercises[i].SourceName}\".");
        }
    }

    private static void ScoreExercise(DraftExercise gold, string goldPartners, DraftExercise candidate,
        string candidatePartners, string dayLabel, Run run)
    {
        var label = $"{dayLabel}, {gold.SourceName}";
        run.Tally("sets.count", gold.Sets.Count == candidate.Sets.Count);
        if (gold.Sets.Count != candidate.Sets.Count)
            run.Note($"{label}: {gold.Sets.Count} sets expected, {candidate.Sets.Count} found.");
        run.TallyEdit("notes", Norm(gold.Notes) == Norm(candidate.Notes), $"{label}: notes differ.");
        run.TallyEdit("superset", goldPartners == candidatePartners, $"{label}: superset partners differ.");
        run.TallyEdit("substitutions", SameSet(Substitutions(gold), Substitutions(candidate)), $"{label}: substitutions differ.");
        run.TallyEdit("demoLinks", SameSet(Links(gold), Links(candidate)), $"{label}: demonstration links differ.");

        var shared = Math.Min(gold.Sets.Count, candidate.Sets.Count);
        for (var i = 0; i < shared; i++) ScoreSet(gold.Sets[i], candidate.Sets[i], $"{label}, set {i + 1}", run);
        for (var i = shared; i < gold.Sets.Count; i++)
        {
            run.MissingSets++;
            run.Edits++;
            TallySet(run, matched: false);
        }
        run.ExtraSets += Math.Max(0, candidate.Sets.Count - gold.Sets.Count);
        run.Edits += Math.Max(0, candidate.Sets.Count - gold.Sets.Count);
        run.GoldSets += gold.Sets.Count;
    }

    private static void ScoreSet(DraftSet gold, DraftSet candidate, string label, Run run)
    {
        run.TallyEdit("repMin", gold.RepMin == candidate.RepMin, $"{label}: minimum reps {Show(gold.RepMin)} expected, {Show(candidate.RepMin)} found.");
        run.TallyEdit("repMax", gold.RepMax == candidate.RepMax, $"{label}: maximum reps {Show(gold.RepMax)} expected, {Show(candidate.RepMax)} found.");
        run.TallyEdit("rpe", SameNumber(gold.TargetRpe, candidate.TargetRpe), $"{label}: RPE {Show(gold.TargetRpe)} expected, {Show(candidate.TargetRpe)} found.");
        run.TallyEdit("rir", Norm(gold.Rir) == Norm(candidate.Rir), $"{label}: RIR \"{gold.Rir}\" expected, \"{candidate.Rir}\" found.");
        run.TallyEdit("rest", gold.RestSeconds == candidate.RestSeconds, $"{label}: rest {Show(gold.RestSeconds)} expected, {Show(candidate.RestSeconds)} found.");
        run.TallyEdit("tempo", Norm(gold.Tempo) == Norm(candidate.Tempo), $"{label}: tempo \"{gold.Tempo}\" expected, \"{candidate.Tempo}\" found.");
        run.TallyEdit("load", Norm(gold.LoadText) == Norm(candidate.LoadText), $"{label}: load \"{gold.LoadText}\" expected, \"{candidate.LoadText}\" found.");
        run.TallyEdit("warmup", gold.Warmup == candidate.Warmup, $"{label}: warm-up flag differs.");
    }

    /// A gold exercise the candidate lacks still counts every gold field as missed.
    private static void TallyUnmatched(DraftExercise gold, Run run)
    {
        foreach (var field in new[] { "sets.count", "notes", "superset", "substitutions", "demoLinks" }) run.Tally(field, false);
        run.GoldSets += gold.Sets.Count;
        foreach (var _ in gold.Sets) TallySet(run, matched: false);
    }

    private static void TallySet(Run run, bool matched)
    {
        foreach (var field in new[] { "repMin", "repMax", "rpe", "rir", "rest", "tempo", "load", "warmup" }) run.Tally(field, matched);
    }

    /// Alternative members match on name and day count, the two things a reviewer would otherwise redo.
    private static void ScoreAlternatives(ImportDraft gold, ImportDraft candidate, Run run)
    {
        var offered = (candidate.AlternativeGroups ?? [])
            .SelectMany(group => group.Members)
            .Select(member => $"{Norm(member.Name)}|{member.DayLineIds?.Count ?? member.DayCount}")
            .ToList();
        foreach (var member in (gold.AlternativeGroups ?? []).SelectMany(group => group.Members))
        {
            var key = $"{Norm(member.Name)}|{member.DayLineIds?.Count ?? member.DayCount}";
            run.TallyEdit("alternatives", offered.Remove(key),
                $"Alternative \"{member.Name}\" ({member.DayLineIds?.Count ?? member.DayCount} days) is missing or differs.");
        }
    }

    private static string DayKey(DraftWorkout day) => $"{day.Week}|{Norm(day.Name)}";

    private static string Partners(List<DraftExercise> exercises, int index)
    {
        var group = exercises[index].SequenceGroup;
        if (string.IsNullOrWhiteSpace(group)) return "";
        return string.Join('|', exercises.Where((other, i) => i != index && other.SequenceGroup == group)
            .Select(other => Norm(other.SourceName)).Order(StringComparer.Ordinal));
    }

    private static HashSet<string> Substitutions(DraftExercise exercise)
        => (exercise.Substitutions ?? []).Select(Norm).Where(name => name.Length > 0).ToHashSet();

    private static HashSet<string> Links(DraftExercise exercise)
        => (exercise.DemoUrl is null ? Enumerable.Empty<string>() : new[] { exercise.DemoUrl })
            .Concat(exercise.DemoLinks?.Values ?? Enumerable.Empty<string>())
            .Select(link => link.Trim().TrimEnd('/').ToLowerInvariant()).Where(link => link.Length > 0).ToHashSet();

    private static bool SameSet(HashSet<string> a, HashSet<string> b) => a.SetEquals(b);
    private static bool SameNumber(double? a, double? b) => a is null ? b is null : b is not null && Math.Abs(a.Value - b.Value) < 0.01;
    private static string Show<T>(T? value) where T : struct => value?.ToString() ?? "unstated";

    /// Lower-case letters and digits only, so case, spacing and punctuation never decide a match.
    internal static string Norm(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var builder = new StringBuilder(text.Length);
        foreach (var character in text) if (char.IsLetterOrDigit(character)) builder.Append(char.ToLowerInvariant(character));
        return builder.ToString();
    }

    private static List<(int Gold, int Candidate)> Align(IReadOnlyList<string> gold, IReadOnlyList<string> candidate)
    {
        var table = new int[gold.Count + 1, candidate.Count + 1];
        for (var i = gold.Count - 1; i >= 0; i--)
            for (var j = candidate.Count - 1; j >= 0; j--)
                table[i, j] = gold[i] == candidate[j] ? table[i + 1, j + 1] + 1 : Math.Max(table[i + 1, j], table[i, j + 1]);
        var pairs = new List<(int, int)>();
        for (int i = 0, j = 0; i < gold.Count && j < candidate.Count;)
        {
            if (gold[i] == candidate[j]) pairs.Add((i++, j++));
            else if (table[i + 1, j] >= table[i, j + 1]) i++;
            else j++;
        }
        return pairs;
    }

    private sealed class Run
    {
        private readonly Dictionary<string, (int Matched, int Total)> fields = FieldNames.ToDictionary(name => name, _ => (0, 0));
        private readonly List<string> differences = [];
        public int MatchedDays, MissingDays, ExtraDays, GoldExercises, MatchedExercises, MissingExercises, ExtraExercises;
        public int GoldSets, MissingSets, ExtraSets, Edits;

        public void Tally(string field, bool matched)
        {
            var (m, t) = fields[field];
            fields[field] = (m + (matched ? 1 : 0), t + 1);
        }

        /// A mismatch is one difference to report and one edit a reviewer would make.
        public void TallyEdit(string field, bool matched, string difference)
        {
            Tally(field, matched);
            if (matched) return;
            Edits++;
            Note(difference);
        }

        public void Note(string text)
        {
            if (differences.Count < MaxDifferences) differences.Add(text);
            else if (differences.Count == MaxDifferences) differences.Add("More differences exist than are listed here.");
        }

        public AccuracyScore Build(int goldDays, int matchedDays) => new(
            goldDays, matchedDays, MissingDays, ExtraDays, GoldExercises, MatchedExercises, MissingExercises, ExtraExercises,
            GoldSets, MissingSets, ExtraSets,
            fields.ToDictionary(pair => pair.Key, pair => new FieldTally(pair.Value.Matched, pair.Value.Total)),
            Edits, differences);
    }
}
