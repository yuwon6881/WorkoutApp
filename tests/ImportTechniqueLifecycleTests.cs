using System.Text.Json;
using System.Net;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportTechniqueLifecycleTests
{
    [Fact]
    public async Task Printed_partial_scope_survives_review_restore_program_creation_and_active_workout()
    {
        await using var harness = await Harness.Create(new()
        {
            ["OpenAi:ApiKey"] = "test-key",
            ["OpenAi:Model"] = "local"
        });
        await harness.SignIn();
        await harness.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));

        var set = """
            {"repMin":8,"repMax":10,"repsText":"8-10","targetRpe":8,"rir":"2","restSeconds":150,
             "restText":"2-3 min","tempo":"3:0:1:0","loadText":"75% 1RM","notes":null,
             "repsSource":"extracted","rpeSource":"extracted","restSource":"extracted"}
            """;
        var outline = """
            {"programTitle":"Partial rep program","chunks":[{"label":"Week 1","block":null,"phase":null,"weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
            """;
        var section = $$"""
            {"programTitle":"Partial rep program","days":[{"block":null,"phase":null,"weekNumber":1,"phaseWeek":1,"dayName":"Day A","isRestDay":false,"notes":null,"sourcePage":1,"exercises":[
              {"sequenceGroup":null,"sourceName":"Barbell bench press","exerciseId":null,"warmupSets":null,"workingSets":"3","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[{{set}},{{set}},{{set}}]}
            ]}]}
            """;
        var handler = new StubHandler(request =>
        {
            var requestBody = request.Content?.ReadAsStringAsync().GetAwaiter().GetResult() ?? "";
            var answer = requestBody.Contains("training_program_outline", StringComparison.Ordinal)
                ? outline
                : section;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","usage":{"input_tokens":10,"output_tokens":10},"output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(answer)}}}]}]}""")
            };
        });
        var source = new ImportSourceInput("partial.pdf", 1,
        [
            new ImportPageText(1, """
                WEEK 1
                DAY LABEL: Day A
                Exercise | Last-Set Intensity Technique | Working Sets | Reps | RIR | Load | Tempo | Rest
                Barbell bench press | Integrated Partials (All Sets) | 3 | 8-10 | 2 | 75% 1RM | 3:0:1:0 | 2-3 min
                """),
        ], [new ImportPageLink(1, "Barbell bench press", "https://youtu.be/qTSTOVVr8rU")]);
        var imports = harness.Imports(handler);

        var pending = await imports.Create(source, default);
        var ready = pending.Status == ImportStatus.Pending
            ? await imports.Extract(pending.Id, default)
            : pending;
        Assert.Equal(ImportStatus.Ready, ready.Status);
        var original = Assert.Single(Assert.Single(ready.Draft!.Workouts).Exercises);
        Assert.Equal(3, original.Sets.Count);
        Assert.All(original.Sets, set =>
        {
            Assert.Equal("Integrated Partials (All Sets)", set.Notes);
            Assert.Equal("8-10", set.RepsText);
            Assert.Equal(8, set.TargetRpe);
            Assert.Equal("2", set.Rir);
            Assert.Equal(150, set.RestSeconds);
            Assert.Equal("2-3 min", set.RestText);
            Assert.Equal("75% 1RM", set.LoadText);
            Assert.Equal("3:0:1:0", set.Tempo);
        });
        Assert.Equal("https://youtu.be/qTSTOVVr8rU", original.DemoUrl);

        var changedDraft = ready.Draft with
        {
            Workouts = [ready.Draft.Workouts.Single() with
            {
                Exercises = [original with { Sets = [original.Sets[0] with { Notes = "Partial reps" }, .. original.Sets.Skip(1)] }]
            }]
        };
        var edited = await imports.Edit(ready.Id, changedDraft, ready.Revision, default);
        var restored = await imports.RestoreExercise(ready.Id, original.LineId, edited.Revision, default);
        var restoredExercise = Assert.Single(Assert.Single(restored.Draft!.Workouts).Exercises);
        Assert.All(restoredExercise.Sets, prescription => Assert.Equal("Integrated Partials (All Sets)", prescription.Notes));

        var program = await imports.Accept(restored.Id, default);
        var template = Assert.Single(program.Workouts);
        Assert.All(Assert.Single(template.Exercises).Sets, prescription => Assert.Equal("Integrated Partials (All Sets)", prescription.Notes));
        Assert.Equal("https://youtu.be/qTSTOVVr8rU", Assert.Single(template.Exercises).DemoUrl);

        var activeProgram = await harness.Programs.SetActive(program.Id, true, program.Revision, default);
        var session = await harness.Workouts.Start(Assert.Single(activeProgram.Workouts).Id, null, default);
        var activeExercise = Assert.Single(session.Exercises);
        Assert.All(activeExercise.Prescription, prescription => Assert.Equal("Integrated Partials (All Sets)", prescription.Notes));
        Assert.All(activeExercise.Prescription, prescription => Assert.Equal(150, prescription.RestSeconds));
        Assert.Equal("https://youtu.be/qTSTOVVr8rU", activeExercise.DemoUrl);
    }
}
