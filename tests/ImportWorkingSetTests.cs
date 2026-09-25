using System.Net;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A training table counts its working sets in a column — "WORKING SETS: 2" — and rates each of
/// them in its own column, rather than printing one row per set. A read that answers with a single
/// set row for such an exercise loses every set but one, and the program created from it
/// prescribed one set where the PDF prescribed two. The stated count is authoritative over the
/// rows returned, so the rows are expanded to match it and the copies say they are this app's own.
public sealed class ImportWorkingSetTests
{
    private const string Outline = """
        {"programTitle":"Nine week block","chunks":[
          {"label":"Week 1","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private static string Day(string workingSets, string warmupSets, string sets) => $$"""
        {"programTitle":"Nine week block","days":[
          {"block":"Base","phase":"Intro","weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,"warmupSets":{{warmupSets}},"workingSets":{{workingSets}},"sets":[{{sets}}]}]}]}
        """;

    private static string Set(double? rpe) => $$"""
        {"repMin":6,"repMax":8,"targetRpe":{{(rpe is null ? "null" : rpe.Value.ToString(System.Globalization.CultureInfo.InvariantCulture))}},"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source() => new("nippard.pdf", 1, [new ImportPageText(1, "WEEK 1\nBarbell bench press 3x5")]);

    private static StubHandler Reading(params string[] bodies)
    {
        var call = 0;
        return new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(bodies[Math.Min(call++, bodies.Length - 1)])}}}]}]}""")
        });
    }

    private static async Task<List<DraftSet>> ReadSets(string workingSets, string warmupSets, string sets)
    {
        await using var h = await Harness.Create(Configured());
        await h.SignIn();
        var imports = h.Imports(Reading(Outline, Day(workingSets, warmupSets, sets)));
        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        return ready.Draft!.Workouts.Single().Exercises.Single().Sets;
    }

    [Fact]
    public async Task A_stated_working_set_count_gives_that_many_sets()
    {
        var sets = await ReadSets("\"2\"", "null", Set(8));

        Assert.Equal(2, sets.Count);
        // The row the page printed keeps its provenance; the one this app added says it is a copy.
        Assert.Equal("extracted", sets[0].RepsSource);
        Assert.Equal("inferred", sets[1].RepsSource);
        Assert.All(sets, set => Assert.Equal(8, set.TargetRpe));
        Assert.All(sets, set => Assert.False(set.Warmup));
    }

    [Fact]
    public async Task Sets_the_read_returned_in_full_are_left_exactly_as_they_came()
    {
        var sets = await ReadSets("\"2\"", "null", $"{Set(8)},{Set(9)}");

        Assert.Equal(2, sets.Count);
        Assert.Equal([8d, 9d], sets.Select(set => set.TargetRpe));
        Assert.All(sets, set => Assert.Equal("extracted", set.RepsSource));
    }

    [Fact]
    public async Task Warm_ups_are_counted_separately_from_the_working_sets_they_precede()
    {
        var sets = await ReadSets("\"2\"", "\"1\"", Set(8));

        Assert.Equal(3, sets.Count);
        Assert.Equal([true, false, false], sets.Select(set => set.Warmup));
    }

    [Fact]
    public async Task A_count_the_table_never_stated_leaves_the_rows_alone()
    {
        var sets = await ReadSets("null", "null", Set(8));

        Assert.Single(sets);
    }
}
