using System.Net;
using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The Ultimate Push Pull Legs System came back with exercises the document never prints — a
/// "Machine Hip Adduction" and a "DB Concentration Curl" in a book where "adduction" and
/// "concentration" occur zero times. Each became a slot to map, and one that happened to match the
/// catalog would have entered the program without anyone seeing it.
public sealed class ImportNameEvidenceTests
{
    private const string Outline = """
        {"programTitle":"Repetitive block","chunks":[
          {"label":"Week 1","block":null,"phase":null,"weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    /// One exercise the page prints, one it does not, and one the page abbreviates.
    private const string Section = """
        {"programTitle":"Repetitive block","days":[
          {"block":null,"phase":null,"weekNumber":1,"phaseWeek":1,"dayName":"Push #1","isRestDay":false,"notes":null,"sourcePage":1,"exercises":[
            {"sequenceGroup":null,"sourceName":"Cable Shrug-In","exerciseId":null,"warmupSets":null,"workingSets":"3","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":8,"rir":null,"restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]},
            {"sequenceGroup":null,"sourceName":"Dumbbell Flye","exerciseId":null,"warmupSets":null,"workingSets":"3","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":8,"rir":null,"restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]},
            {"sequenceGroup":null,"sourceName":"Machine Hip Adduction","exerciseId":null,"warmupSets":null,"workingSets":"3","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":8,"rir":null,"restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
        """;

    private static ImportSourceInput Source() => new("ppl.pdf", 1, [new ImportPageText(1,
        "WEEK 1\nExercise | Sets | Reps | NOTES\nCable Shrug-In | 3 | 6-8 | Shrug up and in.\nDB Flye | 3 | 6-8 | Squeeze your pecs.")]);

    private static ImportService Imports(Harness harness)
    {
        var call = 0;
        var bodies = new[] { Outline, Section };
        return harness.Imports(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(bodies[Math.Min(call++, bodies.Length - 1)])}}}]}]}""")
        }));
    }

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    [Fact]
    public async Task A_name_the_section_pages_do_not_print_is_reported_against_its_own_exercise()
    {
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        var imports = Imports(harness);

        var pending = await imports.Create(Source(), default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        var issue = Assert.Single(ready.ReviewIssues!, item => item.Code == ImportNameEvidence.Code);
        Assert.Contains("Machine Hip Adduction", issue.Message);
        Assert.Equal("warning", issue.Severity);
        Assert.Equal(1, issue.SourcePage);
        // Anchored to the exercise, which is what lets deleting it clear the notice.
        var invented = ready.Draft!.Workouts.SelectMany(day => day.Exercises)
            .Single(exercise => exercise.SourceName == "Machine Hip Adduction");
        Assert.Equal(invented.LineId, issue.ExerciseLineId);
        // An invented name must not be accepted into a program on the reviewer's behalf.
        Assert.False(ready.Acceptable);
    }

    /// The document abbreviates what the read spells out. That is the same printed row, not an
    /// invention, and flagging it would make the check cost more than it saves.
    [Fact]
    public async Task A_name_the_document_abbreviates_is_not_reported()
    {
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        var imports = Imports(harness);

        var ready = await imports.Extract((await imports.Create(Source(), default)).Id, default);

        Assert.DoesNotContain(ready.ReviewIssues!, item => item.Code == ImportNameEvidence.Code
            && (item.Message.Contains("Dumbbell Flye") || item.Message.Contains("Cable Shrug-In")));
    }

    [Fact]
    public async Task Deleting_the_invented_exercise_clears_the_notice()
    {
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        var imports = Imports(harness);
        var ready = await imports.Extract((await imports.Create(Source(), default)).Id, default);

        var trimmed = ready.Draft! with
        {
            Workouts = ready.Draft.Workouts.Select(day => day with
            {
                Exercises = day.Exercises.Where(exercise => exercise.SourceName != "Machine Hip Adduction").ToList()
            }).ToList()
        };
        var edited = await imports.Edit(ready.Id, trimmed, ready.Revision, default);

        Assert.DoesNotContain(edited.ReviewIssues!, item => item.Code == ImportNameEvidence.Code);
    }

    /// The Push/Pull/Legs read returned seven occurrences of a movement its document prints three
    /// times. The name is real, so name-grounding alone cannot see it.
    [Fact]
    public async Task A_movement_read_more_often_than_the_pages_print_it_is_reported()
    {
        const string days = """
            {"programTitle":"Repetitive block","days":[
              {"block":null,"phase":null,"weekNumber":1,"phaseWeek":1,"dayName":"Push #1","isRestDay":false,"notes":null,"sourcePage":1,"exercises":[
                {"sequenceGroup":null,"sourceName":"Cable Shrug-In","exerciseId":null,"warmupSets":null,"workingSets":"3","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[
                  {"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":8,"rir":null,"restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]},
              {"block":null,"phase":null,"weekNumber":2,"phaseWeek":2,"dayName":"Push #2","isRestDay":false,"notes":null,"sourcePage":1,"exercises":[
                {"sequenceGroup":null,"sourceName":"Cable Shrug-In","exerciseId":null,"warmupSets":null,"workingSets":"3","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[
                  {"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":8,"rir":null,"restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]},
              {"block":null,"phase":null,"weekNumber":3,"phaseWeek":3,"dayName":"Push #3","isRestDay":false,"notes":null,"sourcePage":1,"exercises":[
                {"sequenceGroup":null,"sourceName":"Cable Shrug-In","exerciseId":null,"warmupSets":null,"workingSets":"3","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[
                  {"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":8,"rir":null,"restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
            """;
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        var call = 0;
        var bodies = new[] { Outline, days };
        var imports = harness.Imports(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(bodies[Math.Min(call++, bodies.Length - 1)])}}}]}]}""")
        }));
        // The page prints the movement once; the read returned three days of it.
        var source = new ImportSourceInput("ppl.pdf", 1, [new ImportPageText(1,
            "WEEK 1\nExercise | Sets | Reps\nCable Shrug-In | 3 | 6-8")]);

        var ready = await imports.Extract((await imports.Create(source, default)).Id, default);

        var issue = Assert.Single(ready.ReviewIssues!, item => item.Code == ImportNameEvidence.RepeatedCode);
        Assert.Contains("printed 1 time", issue.Message);
        Assert.Contains("read 3 times", issue.Message);
        // The movement is genuinely in the document, so this reports without blocking creation.
        Assert.Equal("info", issue.Severity);
    }

    /// A document that prints every occurrence must stay silent.
    [Fact]
    public async Task A_movement_printed_as_often_as_it_is_read_is_not_reported()
    {
        await using var harness = await Harness.Create(Configured());
        await harness.SignIn();
        var imports = Imports(harness);

        var ready = await imports.Extract((await imports.Create(Source(), default)).Id, default);

        Assert.DoesNotContain(ready.ReviewIssues!, item => item.Code == ImportNameEvidence.RepeatedCode);
    }

}
