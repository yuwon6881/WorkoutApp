using System.Net;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// An import ends by rewriting the account's programs and the days a session can be started from,
/// so a read may not begin while a workout is open. The rule is on starting a read, not on reads
/// already running: one that was in flight when the workout began still finishes and can still be
/// retried, because its provider calls have been paid for either way.
public sealed class ImportActiveWorkoutGateTests
{
    private const string OneSection = """
        {"programTitle":"Short block","chunks":[
          {"label":"Block 1","block":"Base","phase":"Intro","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private const string OneDay = """
        {"programTitle":"Short block","days":[
          {"block":"Base","phase":"Intro","weekNumber":1,"phaseWeek":1,"dayName":"Week 1 Upper","isRestDay":false,"weekday":1,"sourcePage":1,"notes":null,"exercises":[
            {"sequenceGroup":"A1","sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sourcePage":1,"sets":[
              {"repMin":5,"repMax":8,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
        """;

    private static Dictionary<string, string?> Configured() => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini"
    };

    private static ImportSourceInput Source() =>
        new("nippard.pdf", 1, [new ImportPageText(1, "BLOCK 1\nINTRO\nWEEK 1\nBarbell bench press 3x5")]);

    private sealed class StubHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : request.Content.ReadAsStringAsync(ct).Result;
            var payload = body.Contains("training_program_outline") ? OneSection : OneDay;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    $$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(payload)}}}]}]}""")
            });
        }
    }

    private static async Task<(Harness h, Guid templateId)> Ready()
    {
        var h = await Harness.Create(Configured());
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        var benchId = await h.ExerciseId("bench");
        var template = await h.Templates.Create(
            Harness.Template("Push", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);
        return (h, template.Id);
    }

    [Fact]
    public async Task An_import_cannot_start_while_a_workout_is_open()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        await h.Workouts.Start(templateId, null, default);
        var imports = h.Imports(new StubHandler());

        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source(), default));

        Assert.Equal(409, failure.Status);
        Assert.Contains("active workout", failure.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Refusing_the_import_stores_no_source_text_and_spends_no_provider_call()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        await h.Workouts.Start(templateId, null, default);
        var imports = h.Imports(new StubHandler());

        await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source(), default));

        Assert.Empty(await imports.List(default));
        Assert.Empty(h.Db.Usage);
    }

    [Fact]
    public async Task An_import_already_running_still_finishes_after_a_workout_starts()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        var imports = h.Imports(new StubHandler());
        var pending = await imports.Create(Source(), default);

        // The workout begins after the read has been accepted; the read owns work already paid for.
        await h.Workouts.Start(templateId, null, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(1, ready.ChunksDone);
    }

    [Fact]
    public async Task An_import_can_start_once_the_workout_is_finished()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                exercise.Sets.Select(_ => new SetInput(60, 10, 8, true)).ToList())], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
        var imports = h.Imports(new StubHandler());

        var pending = await imports.Create(Source(), default);

        Assert.Equal(1, pending.ChunksTotal);
    }

    [Fact]
    public async Task An_import_can_start_once_the_workout_is_discarded()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Discard(session.Id, default);
        var imports = h.Imports(new StubHandler());

        var pending = await imports.Create(Source(), default);

        Assert.Equal(1, pending.ChunksTotal);
    }
}
