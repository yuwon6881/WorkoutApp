using System.Net;
using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The Ultimate Push Pull Legs System came back named "Ramping Block". Its title is printed in the
/// footer of all 128 pages and the outline pass had read it correctly; the merge then let every
/// section overwrite it, so the program was named after whichever block was read last.
public sealed class ImportProgramTitleTests
{
    private const string Outline = """
        {"programTitle":"The Ultimate Push Pull Legs System","chunks":[
          {"label":"Foundation","block":null,"phase":null,"weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1},
          {"label":"Ramping","block":null,"phase":null,"weekFrom":2,"weekTo":2,"pageFrom":2,"pageTo":2,"dayCount":1}]}
        """;

    private static string Section(string title, int week, int page) => $$"""
        {"programTitle":"{{title}}","days":[
          {"block":null,"phase":null,"weekNumber":{{week}},"phaseWeek":1,"dayName":"Push #1","isRestDay":false,"notes":null,"sourcePage":{{page}},"exercises":[
            {"sequenceGroup":null,"sourceName":"Bench Press","exerciseId":null,"warmupSets":null,"workingSets":"3","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":{{page}},"sets":[
              {"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":8,"rir":null,"restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":{{page}}}]}]}]}
        """;

    [Fact]
    public async Task A_section_does_not_rename_the_program_after_the_block_it_was_given()
    {
        await using var harness = await Harness.Create(new Dictionary<string, string?>
        {
            ["OpenAi:ApiKey"] = "test-key",
            ["OpenAi:Model"] = "gpt-5.4-mini"
        });
        await harness.SignIn();
        var call = 0;
        // Each section faithfully reports the block heading printed over its own pages.
        var bodies = new[] { Outline, Section("Foundation Block", 1, 1), Section("Ramping Block", 2, 2) };
        var imports = harness.Imports(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(bodies[Math.Min(call++, bodies.Length - 1)])}}}]}]}""")
        }));
        var source = new ImportSourceInput("ppl.pdf", 2, [
            new ImportPageText(1, "WEEK 1\nBench Press 3 x 6-8 @ RPE 8"),
            new ImportPageText(2, "WEEK 2\nBench Press 3 x 6-8 @ RPE 8")]);

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, ready.ChunksTotal);
        Assert.Equal("The Ultimate Push Pull Legs System", ready.Draft!.ProgramName);
    }
}
