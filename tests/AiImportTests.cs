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
    /// The browser's side of an import: the page text it read out of a PDF. Six pages of plain
    /// training text is enough for the outline fixtures below, which point at pages 1-4.
    private static ImportSourceInput Source(string fileName = "block.pdf", int pages = 6, int? marker = null)
        => new(fileName, pages, Enumerable.Range(1, pages)
            .Select(page => new ImportPageText(page,
                $"WEEK {page}\nBarbell bench press 3 x 8-10 @ RPE 8{(marker is { } seed ? $"\nvariant {seed}" : "")}"))
            .ToList());

    private const string OneWorkout = """
    {"programName":"Hypertrophy block","weeks":[
      {"week":1,"workouts":[{"name":"Day A","focus":"Push","notes":null,"exercises":[
        {"sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sets":[
          {"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,
           "repsSource":"extracted","rpeSource":"inferred","restSource":"extracted"}]}]}]}]}
    """;

    private const string Outline = """
    {"programTitle":"Faithful block","chunks":[
      {"label":"Block 1 · Base · Week 1","block":"Block 1","phase":"Base Hypertrophy","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":4,"dayCount":1}]}
    """;

    private const string Chunk = """
    {"programTitle":"Faithful block","days":[
      {"block":"Block 1","phase":"Base Hypertrophy","weekNumber":1,"phaseWeek":1,"dayName":"Lower A","isRestDay":false,"weekday":1,"sourcePage":3,"notes":"Keep the tempo","exercises":[
        {"sequenceGroup":"A1","sourceName":"Constant-Tension Lying Leg Curl","exerciseId":null,"warmupSets":"2-3","substitutions":["Seated leg curl","Nordic curl"],"coachingNotes":"Control the eccentric","notes":null,"sourcePage":3,"sets":[
          {"repMin":8,"repMax":12,"repsText":"AMRAP","targetRpe":null,"rir":"2","restSeconds":60,"restText":"3-5 min","tempo":"3010","loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"inferred","restSource":"extracted","sourcePage":3}]}]}]}
    """;

    private const string AlternativesOutline = """
    {"programTitle":"Choices","chunks":[],"alternatives":[
      {"id":"alpha","name":"Alpha","chunks":[{"label":"Alpha week 1","block":"Alpha","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}]},
      {"id":"beta","name":"Beta","chunks":[{"label":"Beta week 1","block":"Beta","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}]}
    ]}
    """;

    private static Dictionary<string, string?> Configured => new() { ["OpenAi:ApiKey"] = "test-key", ["OpenAi:Model"] = "gpt-5.4-mini" };

    [Fact] public async Task An_extracted_program_becomes_a_reviewable_draft_with_its_provenance()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Source("block.pdf"), default);

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
        var partial = await imports.Create(Source("faithful.pdf"), default);

        Assert.Equal(ImportStatus.Pending, partial.Status);
        Assert.Equal("extract", partial.Stage);
        Assert.Equal(0, partial.ChunksDone);
        Assert.Equal(1, partial.ChunksTotal);
        Assert.Equal(1, (await h.Db.Imports.AsNoTracking().SingleAsync()).Calls);

        var ready = await imports.Extract(partial.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.True(ready.Acceptable);
        Assert.Equal(1, ready.UnresolvedCount);
        var exercise = ready.Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal("A1", exercise.SequenceGroup);
        Assert.Equal(1, ready.Draft.Workouts.Single().Weekday);
        Assert.Equal(3, exercise.SourcePage);
        Assert.Equal(["Seated leg curl", "Nordic curl"], exercise.Substitutions);
        Assert.Equal(3, exercise.Sets.Count);
        Assert.All(exercise.Sets.Take(2), set => Assert.True(set.Warmup));
        Assert.False(exercise.Sets[2].Warmup);
        Assert.Equal("AMRAP", exercise.Sets[2].RepsText);
        Assert.Equal("3-5 min", exercise.Sets[2].RestText);
        Assert.Equal("2", exercise.Sets[2].Rir);
        Assert.Equal(8, exercise.Sets[2].TargetRpe);
        Assert.Equal("inferred", exercise.Sets[2].RepsSource);
        // Two AI reads: one outline pass and one chunk. Counted before accepting, because
        // accepting removes the import row.
        Assert.Equal(2, (await h.Db.Imports.AsNoTracking().SingleAsync()).Calls);

        var program = await imports.Accept(ready.Id, "Asia/Kuala_Lumpur", default);
        var workout = Assert.Single(program.Workouts);
        Assert.Equal("Block 1", workout.Block);
        Assert.Equal("Base Hypertrophy", workout.Phase);
        Assert.Equal(1, workout.PhaseWeek);
        Assert.Equal(3, workout.SourcePage);
        Assert.Equal("A1", workout.Exercises.Single().SequenceGroup);
        Assert.Equal("AMRAP", workout.Exercises.Single().Sets[2].RepsText);
        Assert.Equal("Constant-Tension Lying Leg Curl", workout.Exercises.Single().SourceName);
        Assert.Equal(3, workout.Exercises.Single().SourcePage);
        Assert.Equal(3, workout.Exercises.Single().Sets[2].SourcePage);
        Assert.False(program.Active);
        Assert.Equal(ProgramLifecycle.Standby, program.LifecycleStatus);
        Assert.Equal("Asia/Kuala_Lumpur", program.TimeZone);
        Assert.Empty(await h.Db.Imports.AsNoTracking().ToListAsync());
    }

    [Fact] public async Task An_unmatched_exercise_stays_unresolved_but_does_not_block_acceptance()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Source("block.pdf"), default);

        Assert.Null(view.Draft!.Workouts.Single().Exercises.Single().ExerciseId);
        Assert.Single(view.Unresolved);
        Assert.True(view.Acceptable);
        var program = await imports.Accept(view.Id, default);
        Assert.Equal("Barbell bench press", program.Workouts.Single().Exercises.Single().SourceName);
        Assert.Null(program.Workouts.Single().Exercises.Single().ExerciseId);
        Assert.Equal(1, await h.Db.Programs.CountAsync());
    }

    [Fact] public async Task Missing_optional_rpe_or_rest_requires_an_explicit_review_acknowledgement()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var body = OneWorkout.Replace("\"targetRpe\":8", "\"targetRpe\":null").Replace("\"restSeconds\":120", "\"restSeconds\":null");
        var imports = h.Imports(StubHandler.Program(body));
        var view = await imports.Create(Source("unspecified.pdf"), default);

        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Accept(view.Id, default));
        Assert.Equal(409, failure.Status);
        var accepted = await imports.Accept(view.Id, null, true, default);
        Assert.Equal(ProgramLifecycle.Standby, accepted.LifecycleStatus);
    }

    [Fact] public async Task An_exercise_already_in_the_library_is_matched_by_name()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Source("block.pdf"), default);

        Assert.Equal(await h.ExerciseId("bench"), view.Draft!.Workouts.Single().Exercises.Single().ExerciseId);
        Assert.Empty(view.Unresolved);
        Assert.True(view.Acceptable);
    }

    [Fact] public async Task An_id_the_model_invents_is_dropped_rather_than_trusted()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var invented = OneWorkout.Replace("\"exerciseId\":null", $"\"exerciseId\":\"{Guid.NewGuid()}\"");
        var imports = h.Imports(StubHandler.Program(invented));
        var view = await imports.Create(Source("block.pdf"), default);
        Assert.Null(view.Draft!.Workouts.Single().Exercises.Single().ExerciseId);
        Assert.Single(view.Unresolved);
    }

    [Fact] public async Task Accepting_a_mapped_draft_materializes_the_program_and_its_workouts()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Source("block.pdf"), default);

        var program = await imports.Accept(view.Id, default);
        Assert.Equal("Hypertrophy block", program.Name);
        Assert.False(program.Active);
        Assert.Equal(view.Id, program.SourceImportId);
        var workout = Assert.Single(program.Workouts);
        Assert.Equal("Day A", workout.Name);
        Assert.Equal(new SetPrescription(8, 10, 8, 120, null, null, null, null, null, null, false, "extracted", "inferred", "extracted"), workout.Exercises.Single().Sets.Single());
        // Accepting removes the import: the program it produced is the lasting record.
        Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => imports.Get(view.Id, default))).Status);
    }

    [Fact] public async Task An_accepted_program_waits_its_turn_when_another_is_already_active()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var benchId = await h.ExerciseId("bench");
        await h.Programs.Create(new ProgramInput("Existing",
            [new ProgramWorkoutInput(1, "Day A", null, null, [Harness.Exercise(benchId, "Barbell bench press", Harness.Set(8, 10))])], null), true, null, default);

        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Source("block.pdf"), default);
        var program = await imports.Accept(view.Id, default);
        Assert.False(program.Active);
    }

    [Fact] public async Task Re_uploading_the_same_document_reuses_its_draft_without_another_call()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var stub = StubHandler.Program(OneWorkout);
        var imports = h.Imports(stub);
        var first = await imports.Create(Source("block.pdf"), default);
        var second = await imports.Create(Source("block.pdf"), default);
        Assert.Equal(first.Id, second.Id);
        Assert.Equal(1, stub.Calls);
    }

    /// A failed import is removed outright. Its reason travels back in the response that reports
    /// it, and nothing is kept for the user to find and clear later.
    [Fact] public async Task A_failed_import_leaves_nothing_behind()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("{}") }));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("block.pdf"), default));

        Assert.NotEmpty(failure.Message);
        Assert.Empty(await h.Db.Imports.AsNoTracking().ToListAsync());
        Assert.Empty(await imports.List(default));
    }

    [Fact] public async Task A_refusal_is_reported_rather_than_salvaged()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Returning("""{"status":"completed","output":[{"content":[{"type":"refusal","refusal":"no"}]}]}"""));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("block.pdf"), default));
        Assert.Equal(422, failure.Status);
    }

    [Fact] public async Task Malformed_model_output_is_rejected_at_the_boundary()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program("""{"programName":"Broken","weeks":[]}"""));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("block.pdf"), default));
        Assert.Equal(422, failure.Status);
    }

    [Fact] public async Task An_incomplete_run_is_not_turned_into_a_partial_program()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Returning("""{"status":"incomplete","output":[]}"""));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("block.pdf"), default));
        Assert.Equal(422, failure.Status);
    }

    [Fact] public async Task A_timeout_is_reported_as_a_timeout()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(new StubHandler(_ => throw new TaskCanceledException()));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("block.pdf"), default));
        Assert.Equal(504, failure.Status);
    }

    /// A scanned document produces no text on the device, and an empty read is never worth a model
    /// call: it could only invent a program out of nothing.
    [Fact] public async Task A_document_with_no_selectable_text_never_reaches_the_model()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var stub = StubHandler.Program(OneWorkout);
        var imports = h.Imports(stub);
        var scanned = new ImportSourceInput("scanned.pdf", 3, [new ImportPageText(1, "   "), new ImportPageText(2, "")]);
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(scanned, default));
        Assert.Equal(422, failure.Status);
        Assert.Contains("scanned document", failure.Message);
        Assert.Equal(0, stub.Calls);
    }

    [Fact] public async Task A_document_beyond_the_page_limit_is_refused()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var stub = StubHandler.Program(OneWorkout);
        var imports = h.Imports(stub);
        await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("huge.pdf", ImportSourceText.MaxPages + 1), default));
        Assert.Equal(0, stub.Calls);
    }

    [Fact] public async Task The_daily_import_allowance_is_enforced_per_account()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        for (var i = 0; i < ImportService.DailyLimit; i++) await imports.Create(Source($"block{i}.pdf", marker: i), default);
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("one-too-many.pdf", marker: 999), default));
        Assert.Equal(429, failure.Status);
    }

    [Fact] public async Task One_account_cannot_open_another_accounts_import()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Source("block.pdf"), default);

        var bob = await h.CreateUser("bob");
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
        var view = await imports.Create(Source("block.pdf"), default);

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
        var view = await imports.Create(Source("block.pdf"), default);
        await imports.Discard(view.Id, default);
        // Discarding removes the import, so it is simply gone rather than a row in a refused state.
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Accept(view.Id, default));
        Assert.Equal(404, failure.Status);
        Assert.Empty(await h.Db.Imports.AsNoTracking().ToListAsync());
    }

    [Fact] public async Task The_request_carries_page_text_the_schema_and_no_document()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var stub = StubHandler.Program(OneWorkout);
        var imports = h.Imports(stub);
        await imports.Create(Source("block.pdf"), default);

        Assert.Contains("=== PAGE 1 ===", stub.Body);
        // No document, no page images: a provider only ever receives the text layer.
        Assert.DoesNotContain("input_file", stub.Body);
        Assert.DoesNotContain("application/pdf", stub.Body);
        Assert.Contains("\"store\":false", stub.Body);
        Assert.Contains("\"strict\":true", stub.Body);
        Assert.Contains("\"safety_identifier\"", stub.Body);
        Assert.Contains("gpt-5.4-mini", stub.Body);
        // A finished read keeps the draft and drops the text it was made from.
        Assert.All(await h.Db.Imports.AsNoTracking().ToListAsync(), import => Assert.Equal("", import.SourceTextJson));
    }

    [Fact] public async Task Without_a_key_the_importer_says_so_instead_of_failing_obscurely()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("block.pdf"), default));
        Assert.Equal(503, failure.Status);
        Assert.Contains("Manual program building remains available", failure.Message);
    }

    [Fact] public async Task Alternative_programs_are_selected_before_chunk_extraction()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var call = 0;
        var stub = new StubHandler(_ =>
        {
            var body = call++ == 0 ? AlternativesOutline : Chunk;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(body)}}}]}]}""")
            };
        });
        var imports = h.Imports(stub);
        var pending = await imports.Create(Source("choices.pdf"), default);
        Assert.Equal("select", pending.Stage);
        Assert.Equal(2, pending.Alternatives!.Count);
        var selected = await imports.SelectAlternative(pending.Id, "alpha", default);
        Assert.Equal("extract", selected.Stage);
        var ready = await imports.Extract(selected.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, stub.Calls);
    }
}
