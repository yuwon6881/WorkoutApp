using Workout.Api.Services;
using Workout.Tests.Corpus.Accuracy;
using Xunit;

namespace Workout.Tests;

/// The scorer is checked on small synthetic programs whose differences are known exactly, so a
/// number it reports can be traced to a named difference. It says nothing about real documents.
public sealed class ImportAccuracyScorerTests
{
    private static DraftSet Set(int min = 8, int max = 10, double? rpe = 8, int? rest = 120, string? tempo = null,
        string? load = null, string? rir = null, bool warmup = false)
        => new(min, max, rpe, rest, tempo, load, null, Rir: rir, Warmup: warmup);

    private static DraftExercise Exercise(string name, string group = "", string? notes = null,
        List<string>? subs = null, params DraftSet[] sets)
        => new(Guid.NewGuid(), name, null, notes, sets.Length == 0 ? [Set()] : [.. sets], group, subs);

    private static DraftWorkout Day(int week, string name, params DraftExercise[] exercises)
        => new(Guid.NewGuid(), week, name, null, null, [.. exercises]);

    private static DraftWorkout Rest(int week, string name)
        => new(Guid.NewGuid(), week, name, null, null, [], IsRestDay: true);

    private static ImportDraft Draft(params DraftWorkout[] days) => new("Program", [.. days]);

    private static ImportDraft Gold() => Draft(
        Day(1, "Upper", Exercise("Bench press"), Exercise("Row", sets: [Set(), Set(6, 8)])),
        Rest(1, "Rest"),
        Day(2, "Lower", Exercise("Squat")));

    [Fact]
    public void An_identical_draft_scores_perfectly_with_no_corrections()
    {
        var score = ImportAccuracyScorer.Score(Gold(), Gold());
        Assert.Equal(0, score.CorrectionEdits);
        Assert.Equal(3, score.MatchedDays);
        Assert.Equal(3, score.MatchedExercises);
        Assert.All(score.Fields.Values, tally => Assert.Equal(tally.Total, tally.Matched));
        Assert.Equal(1.0, score.FieldAccuracy);
        Assert.Empty(score.Differences);
    }

    [Fact]
    public void Names_match_regardless_of_case_spacing_and_punctuation()
    {
        var candidate = Draft(
            Day(1, "UPPER", Exercise("bench-press"), Exercise("Row", sets: [Set(), Set(6, 8)])),
            Rest(1, "rest"),
            Day(2, "lower ", Exercise("Squat")));
        Assert.Equal(0, ImportAccuracyScorer.Score(Gold(), candidate).CorrectionEdits);
    }

    [Fact]
    public void A_missing_day_and_its_exercises_are_counted_as_omitted_work()
    {
        var candidate = Draft(
            Day(1, "Upper", Exercise("Bench press"), Exercise("Row", sets: [Set(), Set(6, 8)])),
            Rest(1, "Rest"));
        var score = ImportAccuracyScorer.Score(Gold(), candidate);
        Assert.Equal(1, score.MissingDays);
        Assert.Equal(1, score.MissingExercises);
        Assert.Equal(0, score.ExtraDays);
        Assert.Equal(2, score.CorrectionEdits);
        Assert.True(score.FieldAccuracy < 1.0);
        Assert.Contains(score.Differences, text => text.Contains("Lower"));
    }

    [Fact]
    public void An_invented_exercise_is_an_extra_that_needs_deleting()
    {
        var candidate = Draft(
            Day(1, "Upper", Exercise("Bench press"), Exercise("Curl"), Exercise("Row", sets: [Set(), Set(6, 8)])),
            Rest(1, "Rest"),
            Day(2, "Lower", Exercise("Squat")));
        var score = ImportAccuracyScorer.Score(Gold(), candidate);
        Assert.Equal(1, score.ExtraExercises);
        Assert.Equal(1, score.CorrectionEdits);
        Assert.Equal(1.0, score.FieldAccuracy);
    }

    [Fact]
    public void A_swapped_day_order_is_not_hidden_by_matching_names()
    {
        var candidate = Draft(
            Day(2, "Lower", Exercise("Squat")),
            Rest(1, "Rest"),
            Day(1, "Upper", Exercise("Bench press"), Exercise("Row", sets: [Set(), Set(6, 8)])));
        var score = ImportAccuracyScorer.Score(Gold(), candidate);
        Assert.True(score.CorrectionEdits > 0);
        Assert.True(score.MatchedDays < 3);
    }

    [Theory]
    [InlineData(6, 10)]
    [InlineData(8, 12)]
    public void A_wrong_rep_bound_is_one_field_miss_and_one_edit(int min, int max)
    {
        var candidate = Draft(
            Day(1, "Upper", Exercise("Bench press", sets: Set(min, max)), Exercise("Row", sets: [Set(), Set(6, 8)])),
            Rest(1, "Rest"),
            Day(2, "Lower", Exercise("Squat")));
        var score = ImportAccuracyScorer.Score(Gold(), candidate);
        Assert.Equal(1, score.CorrectionEdits);
        Assert.Equal(1, score.Fields["repMin"].Total - score.Fields["repMin"].Matched
            + score.Fields["repMax"].Total - score.Fields["repMax"].Matched);
        Assert.Contains(score.Differences, text => text.Contains("Bench press"));
    }

    [Fact]
    public void Each_prescription_field_is_scored_on_its_own()
    {
        var gold = Draft(Day(1, "A", Exercise("Bench press", sets: Set(rpe: 8, rest: 120, tempo: "3-0-1", load: "70%", rir: "2"))));
        var candidate = Draft(Day(1, "A", Exercise("Bench press", sets: Set(rpe: 9, rest: 90, tempo: "2-0-1", load: "75%", rir: "1"))));
        var score = ImportAccuracyScorer.Score(gold, candidate);
        foreach (var field in new[] { "rpe", "rest", "tempo", "load", "rir" })
            Assert.Equal(0, score.Fields[field].Matched);
        Assert.Equal(5, score.CorrectionEdits);
    }

    [Fact]
    public void An_unstated_value_never_matches_a_stated_one()
    {
        var gold = Draft(Day(1, "A", Exercise("Bench press", sets: Set(rest: 120))));
        var candidate = Draft(Day(1, "A", Exercise("Bench press", sets: Set(rest: null))));
        var score = ImportAccuracyScorer.Score(gold, candidate);
        Assert.Equal(0, score.Fields["rest"].Matched);
        Assert.Equal(1, score.Fields["rest"].Total);
    }

    [Fact]
    public void A_missing_set_is_a_correction_and_lowers_the_set_count_score()
    {
        var gold = Draft(Day(1, "A", Exercise("Row", sets: [Set(), Set(6, 8), Set(4, 6)])));
        var candidate = Draft(Day(1, "A", Exercise("Row", sets: [Set(), Set(6, 8)])));
        var score = ImportAccuracyScorer.Score(gold, candidate);
        Assert.Equal(1, score.MissingSets);
        Assert.Equal(0, score.Fields["sets.count"].Matched);
        Assert.Equal(1, score.CorrectionEdits);
    }

    [Fact]
    public void Supersets_are_compared_by_partners_not_by_group_label()
    {
        var gold = Draft(Day(1, "A", Exercise("Curl", "A"), Exercise("Pushdown", "A"), Exercise("Row")));
        var relabelled = Draft(Day(1, "A", Exercise("Curl", "X"), Exercise("Pushdown", "X"), Exercise("Row")));
        var broken = Draft(Day(1, "A", Exercise("Curl"), Exercise("Pushdown"), Exercise("Row")));
        Assert.Equal(0, ImportAccuracyScorer.Score(gold, relabelled).CorrectionEdits);
        var score = ImportAccuracyScorer.Score(gold, broken);
        Assert.Equal(2, score.CorrectionEdits);
        Assert.Equal(1, score.Fields["superset"].Matched);
    }

    [Fact]
    public void Substitutions_notes_and_links_are_scored_as_sets()
    {
        var gold = Draft(Day(1, "A", Exercise("Bench press", notes: "Pause on chest", subs: ["Dumbbell press", "Push up"])));
        var candidate = Draft(Day(1, "A", Exercise("Bench press", notes: "pause on chest!", subs: ["Push up", "Dumbbell press"])));
        Assert.Equal(0, ImportAccuracyScorer.Score(gold, candidate).CorrectionEdits);

        var wrong = Draft(Day(1, "A", Exercise("Bench press", notes: "Other", subs: ["Push up"])));
        var score = ImportAccuracyScorer.Score(gold, wrong);
        Assert.Equal(0, score.Fields["notes"].Matched);
        Assert.Equal(0, score.Fields["substitutions"].Matched);
        Assert.Equal(2, score.CorrectionEdits);
    }

    [Fact]
    public void Demo_links_match_when_the_same_set_of_destinations_is_present()
    {
        var gold = Draft(Day(1, "A", Exercise("Bench press") with { DemoUrl = "https://youtu.be/abc" }));
        var same = Draft(Day(1, "A", Exercise("Bench press") with { DemoUrl = "https://YOUTU.BE/abc" }));
        var missing = Draft(Day(1, "A", Exercise("Bench press")));
        Assert.Equal(0, ImportAccuracyScorer.Score(gold, same).CorrectionEdits);
        Assert.Equal(1, ImportAccuracyScorer.Score(gold, missing).CorrectionEdits);
    }

    [Fact]
    public void Alternative_members_are_matched_by_name_and_day_count()
    {
        ImportDraft WithAlternatives(string name, int dayCount) => Draft(Day(1, "A", Exercise("Squat"))) with
        {
            AlternativeGroups = [new("g", [new("m1", name, 0, dayCount, DayLineIds: [.. Enumerable.Range(0, dayCount).Select(_ => Guid.NewGuid())])])]
        };
        Assert.Equal(0, ImportAccuracyScorer.Score(WithAlternatives("Option A", 2), WithAlternatives("option a", 2)).CorrectionEdits);
        var score = ImportAccuracyScorer.Score(WithAlternatives("Option A", 2), WithAlternatives("Option A", 3));
        Assert.Equal(0, score.Fields["alternatives"].Matched);
        Assert.Equal(1, score.CorrectionEdits);
    }

    [Fact]
    public void A_draft_without_the_unchosen_options_is_not_penalised_for_them()
    {
        var first = Day(1, "A", Exercise("Squat"));
        var second = Day(1, "B", Exercise("Deadlift"));
        var offered = Draft(first, second) with
        {
            AlternativeGroups = [new("g", [
                new ImportAlternative("x", "Option A", 0, 1, DayLineIds: [first.LineId]),
                new ImportAlternative("y", "Option B", 0, 1, DayLineIds: [second.LineId])])]
        };
        var chosen = ImportDraftAlternatives.Select(offered, "x", "g");

        var legacy = ImportAccuracyScorer.Score(chosen, Draft(Day(1, "A", Exercise("Squat"))), offered, null);
        Assert.Equal(0, legacy.CorrectionEdits);
        Assert.Equal(0, legacy.Fields["alternatives"].Total);
        Assert.Contains(legacy.Differences, text => text.Contains("Alternatives were not scored"));

        var external = ImportAccuracyScorer.Score(chosen, chosen, offered, offered);
        Assert.Equal(2, external.Fields["alternatives"].Total);
        Assert.Equal(2, external.Fields["alternatives"].Matched);
    }

    [Fact]
    public void An_empty_gold_program_is_refused_rather_than_scored()
    {
        Assert.Throws<ArgumentException>(() => ImportAccuracyScorer.Score(Draft(), Gold()));
    }

    [Fact]
    public void Aggregate_ignores_rejected_files_for_rates_but_reports_them()
    {
        var perfect = new AccuracyCase("a", ImportAccuracyScorer.Score(Gold(), Gold()), null);
        var worse = new AccuracyCase("b", ImportAccuracyScorer.Score(Gold(), Draft(Day(1, "Upper", Exercise("Bench press")))), null);
        var summary = AccuracySummary.Of([perfect, worse, new AccuracyCase("c", null, "Add a list of program days.")]);
        Assert.Equal(3, summary.Files);
        Assert.Equal(1, summary.Rejected);
        Assert.Equal(2, summary.Scored);
        Assert.True(summary.MeanFieldAccuracy < 1.0);
        Assert.Equal(worse.Score!.CorrectionEdits, summary.TotalCorrectionEdits);
    }
}
