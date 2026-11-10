using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Spellings an assistant commonly produces for a value the format already supports. They carry the same
/// meaning as the documented form, so the file imports instead of being sent back for a cosmetic change.
public sealed class ExternalImportToleranceTests
{
    private static async Task<ImportService> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null),
            new SeedExercise("squat", "Squat", "Quads", "Barbell", null));
        return h.Imports();
    }

    private static string Row(string name, string group)
        => "{\"sourceName\":\"" + name + "\"" + (group == "" ? "" : ",\"sequenceGroup\":\"" + group + "\"")
            + ",\"sets\":[{\"repMin\":8,\"repMax\":10}]}";

    private static string Day(params string[] rows)
        => "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + string.Join(",", rows) + "]}]}}";

    [Theory]
    [InlineData("AMRAP", "AMRAP")]
    [InlineData("Dropset", "Dropset")]
    [InlineData("drop set", "Dropset")]
    [InlineData("Myo-reps", "Myo-reps")]
    [InlineData("lengthened_partials", "Lengthened partials")]
    [InlineData("LengthenedPartials", "Lengthened partials")]
    [InlineData("Pause", "Pause set")]
    public async Task A_set_type_is_read_whatever_its_capitals_or_separators(string type, string expectedNote)
    {
        var file = Day("{\"sourceName\":\"Bench press\",\"sets\":[{\"repMin\":8,\"repMax\":10,\"type\":\"" + type + "\"}]}");
        var set = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises[0].Sets[0];

        Assert.Equal(expectedNote, set.Notes);
        Assert.False(set.Warmup);
    }

    [Theory]
    [InlineData("Warmup")]
    [InlineData("WARM-UP")]
    [InlineData("warm up")]
    public async Task A_warm_up_type_is_a_warm_up_however_it_is_spelled(string type)
    {
        var file = Day("{\"sourceName\":\"Bench press\",\"sets\":[{\"type\":\"" + type + "\",\"warmup\":true},{\"type\":\"Normal\",\"repMin\":8,\"repMax\":10}]}");
        var sets = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises[0].Sets;

        Assert.True(sets[0].Warmup);
        Assert.Null(sets[0].Notes);
        Assert.False(sets[1].Warmup);
        Assert.Null(sets[1].Notes);
    }

    [Fact]
    public async Task An_unknown_set_type_is_still_refused()
    {
        var file = Day("{\"sourceName\":\"Bench press\",\"sets\":[{\"repMin\":8,\"repMax\":10,\"type\":\"cluster\"}]}");
        var error = await Assert.ThrowsAsync<DomainException>(async () => await (await Ready()).CreateExternalImport(file, "p.json", default));

        Assert.Contains("Choose a supported set type", error.Message);
    }

    [Fact]
    public async Task Superset_members_labelled_with_their_printed_numbers_form_one_superset()
    {
        // A printed A1/A2 pair copied straight into sequenceGroup names one superset, not two groups of one.
        var file = Day(Row("Bench press", "A1"), Row("Squat", "A2"), Row("Bench press", ""), Row("Squat", "b1"), Row("Bench press", "b2"), Row("Squat", "b3"));
        var rows = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises;

        Assert.Equal(["A", "A", "", "b", "b", "b"], rows.Select(row => row.SequenceGroup));
    }

    [Fact]
    public async Task Numbered_labels_repeated_for_a_second_pair_stay_two_supersets()
    {
        var file = Day(Row("Bench press", "A1"), Row("Squat", "A2"), Row("Bench press", "A1"), Row("Squat", "A2"));
        var rows = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises;

        Assert.Equal(["A", "A", "B", "B"], rows.Select(row => row.SequenceGroup));
    }

    [Fact]
    public async Task A_numbered_label_does_not_join_a_group_that_already_uses_its_letter()
    {
        var file = Day(Row("Bench press", "A"), Row("Squat", "A"), Row("Bench press", "A1"), Row("Squat", "A2"));
        var rows = (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises;

        Assert.Equal(["A", "A", "B", "B"], rows.Select(row => row.SequenceGroup));
    }

    [Fact]
    public async Task A_numbered_label_with_no_partner_is_still_a_superset_of_one()
    {
        var file = Day(Row("Bench press", "A1"), Row("Squat", ""));
        var error = await Assert.ThrowsAsync<DomainException>(async () => await (await Ready()).CreateExternalImport(file, "p.json", default));

        Assert.Contains("at least two exercises", error.Message);
    }

    [Theory]
    [InlineData("give the members of one superset the same letter")] // A1 and A2 are one group, A
    [InlineData("is a training day, not a rest day")]                // active recovery is not a rest day
    public void Prompt_settles_the_labels_and_rest_days_an_assistant_gets_wrong(string rule)
        => Assert.Contains(rule, ExternalImportPrompt.Text);
}
