using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportSourceFootnoteTests
{
    [Theory]
    [InlineData("*TAKE THE LAST SET OF EACH EXERCISE EXCEPT CLOSE GRIP BENCH PRESS TO FAILURE")]
    [InlineData("WEEKLY BICEP VOLUME | 21 | *TAKE THE LAST SET OF EACH EXERCISE EXCEPT CLOSE GRIP BENCH PRESS TO FAILURE")]
    public void Starred_failure_footers_keep_the_exception_and_table_scope(string footer)
    {
        var source = $"""
            === PAGE 12 ===
            DAY LABEL: Day 1
            Exercise | Sets | Reps | RPE | Rest | Notes
            CLOSE GRIP BENCH PRESS | 4 | 4-6 | 8 | 3 min | Keep form.
            BAYESIAN CABLE CURL | 2 | 12-15 | 7 | 1 min | Smooth reps.
            {footer}
            DAY LABEL: Day 2
            Exercise | Sets | Reps | RPE | Rest | Notes
            WEIGHTED DIP | 3 | 12-15 | 8 | 2 min | Stay upright.
            """;
        var read = new AiProgram("Arms", [Day(12, "Day 1", "CLOSE GRIP BENCH PRESS", "BAYESIAN CABLE CURL"), Day(12, "Day 2", "WEIGHTED DIP")]);
        var result = ImportTableEvidence.Enrich(read, source);
        var first = result.Days![0].Exercises;
        Assert.All(first[0].Sets, set => Assert.Equal(8, set.TargetRpe));
        Assert.Equal([7d, 10d], first[1].Sets.Select(set => set.TargetRpe));
        Assert.Contains("EXCEPT CLOSE GRIP BENCH PRESS", first[1].CoachingNotes);
        Assert.All(result.Days[1].Exercises.Single().Sets, set => Assert.Equal(8, set.TargetRpe));
        Assert.Equal(Json.Write(result), Json.Write(ImportTableEvidence.Enrich(result, source)));
    }

    [Theory]
    [InlineData("5", "N/A", "WORK UP TO A HEAVY SET OF 5 @RPE9")]
    [InlineData("AMRAP", "85%", "DO AS MANY REPS AS POSSIBLE @RPE9")]
    public void Single_working_set_effort_is_recovered_from_explicit_at_rpe_coaching(string reps, string intensity, string note)
    {
        var source = $"""
            === PAGE 49 ===
            Exercise | Sets | Reps | RPE/%1RM | Rest | Notes
            BARBELL BENCH PRESS | 1 | {reps} | {intensity} | N/A | {note}
            """;
        var result = ImportTableEvidence.Enrich(new AiProgram("Bench", [Day(49, "Upper", "BARBELL BENCH PRESS")]), source);
        var set = result.Days!.Single().Exercises.Single().Sets.Single();
        Assert.Equal(9, set.TargetRpe);
        Assert.Equal("1", set.Rir);
    }

    [Theory]
    [InlineData("IF YOU FEEL STRONG, WORK UP TO @RPE9", "1")]
    [InlineData("WORK UP TO @RPE9", "3")]
    [InlineData("WORK UP TO @RPE8 OR @RPE9", "1")]
    public void Conditional_or_ambiguous_effort_does_not_invent_a_target(string note, string sets)
    {
        var source = $"=== PAGE 49 ===\nExercise | Sets | Reps | RPE | Rest | Notes\nBARBELL BENCH PRESS | {sets} | 5 | N/A | N/A | {note}";
        var result = ImportTableEvidence.Enrich(new AiProgram("Bench", [Day(49, "Upper", "BARBELL BENCH PRESS")]), source);
        Assert.All(result.Days!.Single().Exercises.Single().Sets, set => Assert.Null(set.TargetRpe));
    }

    private static AiDay Day(int page, string name, params string[] names) => new(null, null, 1, 1, name, false, null,
        names.Select(name => new AiExercise(name, null, null, [new AiSet(8, 10, null, null, null, null, null)], SourcePage: page)).ToList(), page);
}
