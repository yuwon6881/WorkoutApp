using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A target the PDF leaves blank is only noted; one its table prints and the reader lost must
/// stop the import until someone looks. Upper/Lower 4x lost every RPE into its rest cell and the
/// review showed nothing more than an info note.
public sealed class ImportUnreadValueTests
{
    private const string Page = """
        === PAGE 37 ===
        Exercise | SETS | REPS | REST | RPE | NOTES
        Farmers Walk | 3 | 40 | 1.0 |  | Lift heavy
        Barbell Hip Thrust | 4 | 12 | 2-3 MIN 8 | 2-3 MIN 8 | Fully extend your hips
        Heavy Negative Curl | 0 | 0 | 1.5 | 10 | Control the negative
        """;

    private static AiExercise Exercise(string name) => new(name, null, null,
        [new AiSet(8, 10, null, null, null, null, null)], SourcePage: 37);

    private static AiProgram Program() => new("Upper Lower", [new AiDay(null, null, 1, 1, "Lower #2", false, null,
        [Exercise("Farmers Walk"), Exercise("Barbell Hip Thrust"), Exercise("Heavy Negative Curl")], 37)]);

    [Fact]
    public void A_blank_cell_is_the_page_saying_none_and_an_unread_cell_is_not()
    {
        var exercises = Assert.Single(ImportTableEvidence.Enrich(Program(), Page).Days!).Exercises;

        var walk = exercises.Single(exercise => exercise.SourceName == "Farmers Walk");
        var thrust = exercises.Single(exercise => exercise.SourceName == "Barbell Hip Thrust");
        Assert.All(walk.Sets, set => Assert.Equal("extracted", set.RpeSource));
        Assert.All(thrust.Sets, set => Assert.Null(set.TargetRpe));
        Assert.All(thrust.Sets, set => Assert.Equal("inferred", set.RpeSource));
    }

    [Fact]
    public void A_row_printed_with_zero_sets_is_left_out_of_that_week()
    {
        var exercises = Assert.Single(ImportTableEvidence.Enrich(Program(), Page).Days!).Exercises;

        Assert.DoesNotContain(exercises, exercise => exercise.SourceName == "Heavy Negative Curl");
        Assert.Equal(2, exercises.Count);
    }

    [Fact]
    public void Review_notes_stated_gaps_and_warns_on_unread_ones()
    {
        DraftSet Set(string rpeSource, string restSource) => new(8, 10, null, null, null, null, null,
            RpeSource: rpeSource, RestSource: restSource, SourcePage: 37);
        var day = new DraftWorkout(Guid.NewGuid(), 1, "Lower #2", null, null,
        [
            new DraftExercise(Guid.NewGuid(), "Farmers Walk", null, null, [Set("extracted", "extracted")], SourcePage: 37),
            new DraftExercise(Guid.NewGuid(), "Barbell Hip Thrust", null, null, [Set("inferred", "inferred")], SourcePage: 37)
        ], null, null, 1, false, 37);

        var issues = ImportValidation.ReviewIssues(new ImportDraft("Upper Lower", [day]));

        Assert.Contains(issues, issue => issue.Code == "rpe_unspecified" && issue.Severity == "info" && issue.Message.StartsWith("1 working set"));
        Assert.Contains(issues, issue => issue.Code == "rpe_unread" && issue.Severity == "warning");
        Assert.Contains(issues, issue => issue.Code == "rest_unspecified" && issue.Severity == "info");
        Assert.Contains(issues, issue => issue.Code == "rest_unread" && issue.Severity == "warning");
    }

    [Fact]
    public void A_copy_made_up_to_the_set_count_keeps_a_stated_blank()
    {
        var copy = ImportSetKinds.Repeated(new DraftSet(8, 10, null, null, null, null, null, RpeSource: "extracted", RestSource: "extracted"));

        Assert.Equal("extracted", copy.RpeSource);
        Assert.Equal("extracted", copy.RestSource);
        Assert.Equal("inferred", copy.RepsSource);
    }

    /// High Frequency Full Body heads one column "RPE/%" and prints either "RPE8" or "77.5%" in it.
    [Fact]
    public void An_rpe_or_percentage_column_reads_both()
    {
        const string text = """
            === PAGE 40 ===
            WORKOUT | EXERCISE | # OF WARMUP SETS | # OF WORKING SETS | REPS / DURATION | RPE/% | REST | NOTES
             | BACK SQUAT | 3 | 4 | 4 | 77.5% | 2-4 MIN | Sit back
             | DUMBBELL INCLINE PRESS | 2 | 3 | 8 | RPE8 | 2-3 MIN | Upper pecs
            """;
        var program = new AiProgram("HF", [new AiDay(null, null, 1, 1, "Day 1", false, null,
            [Exercise("BACK SQUAT") with { SourcePage = 40 }, Exercise("DUMBBELL INCLINE PRESS") with { SourcePage = 40 }], 40)]);

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        Assert.All(exercises[1].Sets, set => Assert.Equal(8, set.TargetRpe));
        Assert.All(exercises[0].Sets, set => Assert.Contains("77.5%", set.LoadText));
    }

    /// The Bodybuilding Transformation System prints "N/A" for an early-set RPE it does not ask for
    /// and a value for the last set; the early set's blank is the page's own statement.
    [Fact]
    public void Each_set_reads_blankness_from_its_own_early_or_last_column()
    {
        const string text = """
            === PAGE 8 ===
            Exercise | WORKING SETS | Reps | Early Set RPE | Last Set RPE | Rest | NOTES
            Machine Hip Abduction | 2 | 10-12 | N/A | ~8-9 | 1-2 min | Use pads
            Lat Pulldown (Feeder Sets) | 2 | 10 | See Notes | See Notes | ~2-3 min | Build up from set to set
            """;
        var program = new AiProgram("BTS", [new AiDay(null, null, 1, 1, "Legs", false, null,
            [Exercise("Machine Hip Abduction") with { SourcePage = 8 }, Exercise("Lat Pulldown (Feeder Sets)") with { SourcePage = 8 }], 8)]);

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, text).Days!).Exercises;

        Assert.Null(exercises[0].Sets[0].TargetRpe);
        Assert.Equal("extracted", exercises[0].Sets[0].RpeSource);
        Assert.NotNull(exercises[0].Sets[1].TargetRpe);
        Assert.All(exercises[1].Sets, set => Assert.Equal("extracted", set.RpeSource));
    }

    /// Pure Bodybuilding Full Body p.7 prints six exercises; the read returned a seventh with no
    /// name and no sets, which became an "Unnamed exercise" slot and four review items.
    [Fact]
    public void A_nameless_exercise_no_printed_row_accounts_for_is_dropped()
    {
        var program = new AiProgram("Full Body", [new AiDay(null, null, 1, 1, "Full Body #2", false, null,
            [Exercise("Farmers Walk"), new AiExercise("", null, null, [], SourcePage: 37)], 37)]);

        var exercises = Assert.Single(ImportTableEvidence.Enrich(program, Page).Days!).Exercises;

        Assert.Equal(["Farmers Walk"], exercises.Select(exercise => exercise.SourceName));
    }
}
