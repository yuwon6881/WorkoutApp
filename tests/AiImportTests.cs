using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class AiImportTests
{
    private static byte[] Pdf(int pages = 2, int? marker = null)
    {
        var body = new StringBuilder("%PDF-1.7\n");
        for (var i = 0; i < pages; i++) body.Append("/Type /Page \n");
        if (marker is { } value) body.Append($"% seed {value}\n");
        body.Append("%%EOF");
        return Encoding.Latin1.GetBytes(body.ToString());
    }

    private const string OneWorkout = """
    {"programName":"Hypertrophy block","description":"Four weeks","weeks":[
      {"week":1,"workouts":[{"name":"Day A","focus":"Push","notes":null,"exercises":[
        {"sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sets":[
          {"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,
           "repsSource":"extracted","rpeSource":"inferred","restSource":"extracted"}]}]}]}]}
    """;

    private const string Outline = """
    {"programTitle":"Faithful block","description":"Blocks survive","chunks":[
      {"label":"Block 1 · Base · Week 1","block":"Block 1","phase":"Base Hypertrophy","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":4,"dayCount":1}]}
    """;

    private const string Chunk = """
    {"programTitle":"Faithful block","description":"Blocks survive","days":[
      {"block":"Block 1","phase":"Base Hypertrophy","weekNumber":1,"phaseWeek":1,"dayName":"Lower A","isRestDay":false,"notes":"Keep the tempo","exercises":[
        {"sequenceGroup":"A1","sourceName":"Constant-Tension Lying Leg Curl","exerciseId":null,"warmupSets":"2-3","substitutions":["Seated leg curl","Nordic curl"],"coachingNotes":"Control the eccentric","notes":null,"sets":[
          {"repMin":8,"repMax":12,"repsText":"AMRAP","targetRpe":null,"rir":"2","percent1Rm":"75%","restSeconds":60,"restText":"3-5 min","tempo":"3010","loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"inferred","restSource":"extracted"}]}]}]}
    """;

    private static Dictionary<string, string?> Configured => new() { ["OpenAi:ApiKey"] = "test-key", ["OpenAi:Model"] = "gpt-5.4-mini" };

    [Fact] public async Task An_extracted_program_becomes_a_reviewable_draft_with_its_provenance()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Pdf(), "block.pdf", default);

        Assert.Equal(ImportStatus.Ready, view.Status);
        var exercise = view.Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal("Barbell bench press", exercise.SourceName);
        Assert.Equal("extracted", exercise.Sets[0].RepsSource);
        Assert.Equal("inferred", exercise.Sets[0].RpeSource);
        Assert.Equal(8, exercise.Sets[0].RepMin);
        Assert.Equal(10, exercise.Sets[0].RepMax);
    }

    [Fact] public async Task A_chunked_import_preserves_blocks_verbatim_targets_and_accepts_unmapped_names()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var call = 0;
        var stub = new StubHandler(_ =>
        {
            var body = call++ == 0 ? Outline : Chunk;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","usage":{"input_tokens":10,"output_tokens":20},"output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(body)}}}]}]}""")
            };
        });
        var imports = h.Imports(stub);
        var partial = await imports.Create(Pdf(), "faithful.pdf", default);

        Assert.Equal(ImportStatus.Pending, partial.Status);
        Assert.Equal("extract", partial.Stage);
        Assert.Equal(0, partial.ChunksDone);
        Assert.Equal(1, partial.ChunksTotal);
        Assert.Equal(1, (await h.Db.Imports.AsNoTracking().SingleAsync()).Calls);

        var ready = await imports.Extract(partial.Id, Pdf(), "faithful.pdf", default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.True(ready.Acceptable);
        Assert.Equal(1, ready.UnresolvedCount);
        var exercise = ready.Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal("A1", exercise.SequenceGroup);
        Assert.Equal(["Seated leg curl", "Nordic curl"], exercise.Substitutions);
        Assert.Equal(3, exercise.Sets.Count);
        Assert.All(exercise.Sets.Take(2), set => Assert.True(set.Warmup));
        Assert.False(exercise.Sets[2].Warmup);
        Assert.Equal("AMRAP", exercise.Sets[2].RepsText);
        Assert.Equal("3-5 min", exercise.Sets[2].RestText);
        Assert.Equal("75%", exercise.Sets[2].Percent1Rm);
        Assert.Equal("2", exercise.Sets[2].Rir);
        Assert.Equal(8, exercise.Sets[2].TargetRpe);
        Assert.Equal("inferred", exercise.Sets[2].RepsSource);

        var program = await imports.Accept(ready.Id, default);
        var workout = Assert.Single(program.Workouts);
        Assert.Equal("Block 1", workout.Block);
        Assert.Equal("Base Hypertrophy", workout.Phase);
        Assert.Equal(1, workout.PhaseWeek);
        Assert.Equal("A1", workout.Exercises.Single().SequenceGroup);
        Assert.Equal("AMRAP", workout.Exercises.Single().Sets[2].RepsText);
        Assert.Equal("Constant-Tension Lying Leg Curl", workout.Exercises.Single().SourceName);
        Assert.Equal(2, (await h.Db.Imports.AsNoTracking().SingleAsync()).Calls);
    }

    [Fact] public async Task An_unmatched_exercise_stays_unresolved_but_does_not_block_acceptance()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Pdf(), "block.pdf", default);

        Assert.Null(view.Draft!.Workouts.Single().Exercises.Single().ExerciseId);
        Assert.Single(view.Unresolved);
        Assert.True(view.Acceptable);
        var program = await imports.Accept(view.Id, default);
        Assert.Equal("Barbell bench press", program.Workouts.Single().Exercises.Single().SourceName);
        Assert.Null(program.Workouts.Single().Exercises.Single().ExerciseId);
        Assert.Equal(1, await h.Db.Programs.CountAsync());
    }

    [Fact] public async Task An_exercise_already_in_the_library_is_matched_by_name()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Pdf(), "block.pdf", default);

        Assert.Equal(await h.ExerciseId("bench"), view.Draft!.Workouts.Single().Exercises.Single().ExerciseId);
        Assert.Empty(view.Unresolved);
        Assert.True(view.Acceptable);
    }

    [Fact] public async Task A_draft_parked_before_a_seed_picks_the_exercise_up_on_rematch()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Pdf(), "block.pdf", default);
        Assert.True(view.Acceptable);

        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var rematched = await imports.Rematch(view.Id, default);
        Assert.Empty(rematched.Unresolved);
        Assert.True(rematched.Acceptable);
    }

    [Fact] public async Task An_id_the_model_invents_is_dropped_rather_than_trusted()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var invented = OneWorkout.Replace("\"exerciseId\":null", $"\"exerciseId\":\"{Guid.NewGuid()}\"");
        var imports = h.Imports(StubHandler.Program(invented));
        var view = await imports.Create(Pdf(), "block.pdf", default);
        Assert.Null(view.Draft!.Workouts.Single().Exercises.Single().ExerciseId);
        Assert.Single(view.Unresolved);
    }

    [Fact] public async Task Accepting_a_mapped_draft_materializes_the_program_and_its_workouts()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Pdf(), "block.pdf", default);

        var program = await imports.Accept(view.Id, default);
        Assert.Equal("Hypertrophy block", program.Name);
        Assert.True(program.Active);
        Assert.Equal(view.Id, program.SourceImportId);
        var workout = Assert.Single(program.Workouts);
        Assert.Equal("Day A", workout.Name);
        Assert.Equal(new SetPrescription(8, 10, 8, 120, null, null, null, null, null, null, null, false, "extracted", "inferred", "extracted"), workout.Exercises.Single().Sets.Single());
        Assert.Equal(ImportStatus.Accepted, (await imports.Get(view.Id, default)).Status);
    }

    [Fact] public async Task An_accepted_program_waits_its_turn_when_another_is_already_active()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var benchId = await h.ExerciseId("bench");
        await h.Programs.Create(new ProgramInput("Existing", null,
            [new ProgramWorkoutInput(1, "Day A", null, null, [Harness.Exercise(benchId, "Barbell bench press", Harness.Set(8, 10))])], null), true, null, default);

        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Pdf(), "block.pdf", default);
        var program = await imports.Accept(view.Id, default);
        Assert.False(program.Active);
    }

    [Fact] public async Task Re_uploading_the_same_document_reuses_its_draft_without_another_call()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var stub = StubHandler.Program(OneWorkout);
        var imports = h.Imports(stub);
        var first = await imports.Create(Pdf(), "block.pdf", default);
        var second = await imports.Create(Pdf(), "block.pdf", default);
        Assert.Equal(first.Id, second.Id);
        Assert.Equal(1, stub.Calls);
    }

    [Fact] public async Task A_failed_import_keeps_only_its_error_and_has_to_be_uploaded_again()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("{}") }));
        await Assert.ThrowsAsync<DomainException>(() => imports.Create(Pdf(), "block.pdf", default));

        var row = await h.Db.Imports.AsNoTracking().SingleAsync();
        Assert.Equal(ImportStatus.Failed, row.Status);
        Assert.NotEmpty(row.Error);
        Assert.Empty(row.DraftJson);
    }

    [Fact] public async Task A_refusal_is_reported_rather_than_salvaged()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Returning("""{"status":"completed","output":[{"content":[{"type":"refusal","refusal":"no"}]}]}"""));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Pdf(), "block.pdf", default));
        Assert.Equal(422, failure.Status);
    }

    [Fact] public async Task Malformed_model_output_is_rejected_at_the_boundary()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program("""{"programName":"Broken","description":null,"weeks":[]}"""));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Pdf(), "block.pdf", default));
        Assert.Equal(422, failure.Status);
    }

    [Fact] public async Task An_incomplete_run_is_not_turned_into_a_partial_program()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Returning("""{"status":"incomplete","output":[]}"""));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Pdf(), "block.pdf", default));
        Assert.Equal(422, failure.Status);
    }

    [Fact] public async Task A_timeout_is_reported_as_a_timeout()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(new StubHandler(_ => throw new TaskCanceledException()));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Pdf(), "block.pdf", default));
        Assert.Equal(504, failure.Status);
    }

    [Fact] public async Task A_file_that_is_not_a_PDF_never_reaches_the_model()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var stub = StubHandler.Program(OneWorkout);
        var imports = h.Imports(stub);
        await Assert.ThrowsAsync<DomainException>(() => imports.Create(Encoding.UTF8.GetBytes("PK not a pdf"), "block.pdf", default));
        Assert.Equal(0, stub.Calls);
    }

    [Fact] public async Task A_document_beyond_the_page_limit_is_refused()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var stub = StubHandler.Program(OneWorkout);
        var imports = h.Imports(stub);
        await Assert.ThrowsAsync<DomainException>(() => imports.Create(Pdf(PdfInspection.MaxPages + 1), "huge.pdf", default));
        Assert.Equal(0, stub.Calls);
    }

    [Fact] public async Task The_daily_import_allowance_is_enforced_per_account()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        for (var i = 0; i < ImportService.DailyLimit; i++) await imports.Create(Pdf(2, i), $"block{i}.pdf", default);
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Pdf(2, 999), "one-too-many.pdf", default));
        Assert.Equal(429, failure.Status);
    }

    [Fact] public async Task One_account_cannot_open_another_accounts_import()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Pdf(), "block.pdf", default);

        var bob = await h.Auth.Register("bob", "another long password", default);
        h.Db.ChangeTracker.Clear();
        h.Db.CurrentUser = bob.Id;
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Get(view.Id, default));
        Assert.Equal(404, failure.Status);
    }

    [Fact] public async Task A_reviewer_edit_is_saved_and_can_carry_its_own_provenance()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Pdf(), "block.pdf", default);

        var workout = view.Draft!.Workouts.Single();
        var exercise = workout.Exercises.Single();
        var edited = view.Draft with
        {
            Workouts = [workout with { Exercises = [exercise with { Sets = [exercise.Sets[0] with { RepMin = 5, RepMax = 5, RepsSource = "userEdited" } ] }] }]
        };
        var saved = await imports.Edit(view.Id, edited, default);
        var set = saved.Draft!.Workouts.Single().Exercises.Single().Sets.Single();
        Assert.Equal(5, set.RepMin);
        Assert.Equal("userEdited", set.RepsSource);
    }

    [Fact] public async Task A_discarded_draft_cannot_be_accepted_afterwards()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Pdf(), "block.pdf", default);
        await imports.Discard(view.Id, default);
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Accept(view.Id, default));
        Assert.Equal(409, failure.Status);
    }

    [Fact] public async Task The_request_carries_the_PDF_the_schema_and_no_stored_copy()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var stub = StubHandler.Program(OneWorkout);
        var imports = h.Imports(stub);
        await imports.Create(Pdf(), "block.pdf", default);

        Assert.Contains("\"type\":\"input_file\"", stub.Body);
        Assert.Contains("data:application/pdf;base64,", stub.Body);
        Assert.Contains("\"store\":false", stub.Body);
        Assert.Contains("\"strict\":true", stub.Body);
        Assert.Contains("\"safety_identifier\"", stub.Body);
        Assert.Contains("gpt-5.4-mini", stub.Body);
        // Nothing keeps the document itself.
        Assert.Empty(await h.Db.Imports.AsNoTracking().Where(i => i.DraftJson.Contains("%PDF")).ToListAsync());
    }

    [Fact] public async Task Without_a_key_the_importer_says_so_instead_of_failing_obscurely()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Pdf(), "block.pdf", default));
        Assert.Equal(503, failure.Status);
        Assert.Contains("Manual program building remains available", failure.Message);
    }
}
