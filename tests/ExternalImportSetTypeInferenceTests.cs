using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A file that prints a set's type only in its reps or coaching text still gets the set type the app has
/// for it. A set has one type: any other type outranks AMRAP, and a controlled-tempo set (a 3-second
/// negative) is its own type.
public sealed class ExternalImportSetTypeInferenceTests
{
    private static async Task<ImportService> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("pullup", "Pull-Up", "Lats", "Bodyweight", null));
        return h.Imports();
    }

    private static async Task<DraftSet> FirstSet(string exerciseNotes, string setJson)
    {
        var notes = exerciseNotes == "" ? "" : ",\"notes\":\"" + exerciseNotes + "\"";
        var file = "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":4,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Pull-Up\"" + notes + ",\"sets\":[" + setJson + "]}]}]}}";
        return (await (await Ready()).CreateExternalImport(file, "p.json", default)).Draft!.Workouts[0].Exercises[0].Sets[0];
    }

    [Theory]
    [InlineData("tempo")]
    [InlineData("Tempo set")]
    public async Task A_tempo_set_type_is_accepted(string type)
    {
        var set = await FirstSet("", "{\"repMin\":5,\"repMax\":5,\"type\":\"" + type + "\"}");
        Assert.Equal("Tempo set", set.Notes);
        Assert.Equal(SetTechniques.Tempo, SetTechniques.Of(set.Notes));
    }

    [Theory]
    [InlineData("AMRAP")]
    [InlineData("Max reps")]
    [InlineData("As many reps as possible")]
    public async Task Printed_open_reps_without_a_type_make_an_amrap_set(string reps)
    {
        var set = await FirstSet("", "{\"repsText\":\"" + reps + "\"}");
        Assert.Contains("AMRAP", set.Notes);
    }

    [Fact]
    public async Task A_set_note_that_repeats_the_exercise_note_still_marks_amrap()
    {
        var set = await FirstSet("AMRAP", "{\"repsText\":\"AMRAP\",\"notes\":\"AMRAP\"}");
        Assert.Contains("AMRAP", set.Notes);
    }

    [Theory]
    [InlineData("3 seconds negative", "AMRAP")]
    [InlineData("3-sec negative", "AMRAP")]
    [InlineData("Lower for a 3 second negative", "AMRAP")]
    public async Task A_negative_outranks_amrap_when_both_are_printed(string coaching, string reps)
    {
        var set = await FirstSet(coaching, "{\"repsText\":\"" + reps + "\"}");
        Assert.Contains("Tempo set", set.Notes);
        Assert.DoesNotContain("AMRAP", set.Notes);
    }

    [Fact]
    public async Task Another_set_type_outranks_amrap()
    {
        var set = await FirstSet("", "{\"repsText\":\"AMRAP\",\"type\":\"dropset\"}");
        Assert.Contains("Dropset", set.Notes);
        Assert.DoesNotContain("AMRAP", set.Notes);
    }

    [Fact]
    public async Task A_warm_up_is_never_given_a_type_from_its_text()
    {
        var set = await FirstSet("3 seconds negative", "{\"warmup\":true,\"type\":\"warmup\",\"repsText\":\"AMRAP\"}");
        Assert.True(set.Warmup);
        Assert.Null(set.Notes);
    }

    [Fact]
    public async Task A_plain_set_stays_a_plain_set()
    {
        var set = await FirstSet("Controlled reps", "{\"repMin\":8,\"repMax\":10}");
        Assert.Null(set.Notes);
    }
}
