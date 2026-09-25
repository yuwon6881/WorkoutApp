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
      {"id":"full-body","name":"Full Body","chunks":[{"label":"Full Body week 1","block":"Full Body","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}]},
      {"id":"upper-lower","name":"Upper/Lower","chunks":[{"label":"Upper/Lower week 1","block":"Upper/Lower","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}]},
      {"id":"body-part","name":"Body Part Split","chunks":[{"label":"Body Part Split week 1","block":"Body Part Split","phase":"Base","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":2,"dayCount":1}]}
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

    [Fact]
    public async Task A_ready_import_from_the_previous_processing_version_is_not_reused()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var source = Source("versioned.pdf");
        var oldReady = await imports.Create(source, default);
        var oldRow = await h.Db.Imports.SingleAsync(row => row.Id == oldReady.Id);
        oldRow.PromptVersion = "workout-import-v16-rest-bands";
        await h.Db.SaveChangesAsync();

        var refreshed = await imports.Create(source, default);

        Assert.NotEqual(oldReady.Id, refreshed.Id);
        Assert.Equal("workout-import-v16-rest-bands", oldRow.PromptVersion);
        Assert.Equal(ImportStatus.Ready, oldRow.Status);
        Assert.Equal(WorkoutAi.PromptVersion, (await h.Db.Imports.SingleAsync(row => row.Id == refreshed.Id)).PromptVersion);
    }

    [Fact]
    public async Task Chunked_import_recovers_printed_early_last_rpe_without_assigning_effort_to_warmups()
    {
        const string outline = """
            {"programTitle":"Pure Bodybuilding Phase 2","chunks":[{"label":"Week 1","block":"Block 1","phase":"Build","weekFrom":1,"weekTo":1,"pageFrom":12,"pageTo":13,"dayCount":2}]}
            """;
        const string section = """
            {"programTitle":"Pure Bodybuilding Phase 2","days":[
              {"block":"Block 1","phase":"Build","weekNumber":1,"phaseWeek":1,"dayName":"Legs #2","isRestDay":false,"notes":null,"sourcePage":12,"exercises":[
                {"sequenceGroup":null,"sourceName":"Seated Leg Curl","exerciseId":null,"warmupSets":"2","workingSets":"2","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":12,"sets":[{"repMin":10,"repMax":12,"repsText":"10-12","targetRpe":null,"rir":null,"restSeconds":null,"restText":null,"tempo":null,"loadText":null,"notes":null,"repsSource":"inferred","rpeSource":"inferred","restSource":"inferred","sourcePage":12}]},
                {"sequenceGroup":null,"sourceName":"Barbell RDL","exerciseId":null,"warmupSets":"2","workingSets":"2","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":12,"sets":[{"repMin":6,"repMax":8,"repsText":"6-8","targetRpe":null,"rir":null,"restSeconds":null,"restText":null,"tempo":null,"loadText":null,"notes":null,"repsSource":"inferred","rpeSource":"inferred","restSource":"inferred","sourcePage":12}]}]},
              {"block":"Block 1","phase":"Build","weekNumber":1,"phaseWeek":1,"dayName":"Arms & Weak Points #2","isRestDay":false,"notes":null,"sourcePage":13,"exercises":[
                {"sequenceGroup":null,"sourceName":"Weak Point Exercise 1 (optional)","exerciseId":null,"warmupSets":"1","workingSets":"2","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":13,"sets":[{"repMin":10,"repMax":12,"repsText":"10-12","targetRpe":null,"rir":null,"restSeconds":null,"restText":null,"tempo":null,"loadText":null,"notes":null,"repsSource":"inferred","rpeSource":"inferred","restSource":"inferred","sourcePage":13}]}]}]}
            """;
        var responseIndex = 0;
        var responses = new[] { outline, section };
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(responses[Math.Min(responseIndex++, 1)])}}}]}]}""")
        });

        await using var harness = await Harness.Create(Configured);
        await harness.SignIn();
        var imports = harness.Imports(handler);
        var source = new ImportSourceInput("pure-bodybuilding.pdf", 13, [
            new ImportPageText(12, "WEEK 1\nDAY LABEL: Legs #2\nExercise | Warm-up Sets | Working Sets | Reps | Early Set RPE | Last Set RPE | Rest (min)\nSeated Leg Curl | 2 | 2 | 10-12 | 7 | 9 | 2\nBarbell RDL | 2 | 2 | 6-8 | 5 | 7 | 3"),
            new ImportPageText(13, "WEEK 1\nDAY LABEL: Arms & Weak Points #2\nExercise | Warm-up Sets | Working Sets | Reps | Early Set RPE | Last Set RPE | Rest (min)\nWeak Point Exercise 1 (optional) | 1 | 2 | 10-12 | 7 | 9 | 2")
        ]);

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        var days = ready.Draft!.Workouts;
        var legCurl = days.Single(day => day.Name == "Legs #2").Exercises.Single(exercise => exercise.SourceName == "Seated Leg Curl");
        Assert.Equal(4, legCurl.Sets.Count);
        Assert.All(legCurl.Sets.Take(2), set =>
        {
            Assert.True(set.Warmup);
            Assert.Null(set.TargetRpe);
            Assert.Null(set.Rir);
        });
        Assert.Equal([7d, 9d], legCurl.Sets.Skip(2).Select(set => set.TargetRpe));
        Assert.Equal(["3", "1"], legCurl.Sets.Skip(2).Select(set => set.Rir));

        var rdl = days.Single(day => day.Name == "Legs #2").Exercises.Single(exercise => exercise.SourceName == "Barbell RDL");
        Assert.Equal([null, 7d], rdl.Sets.Skip(2).Select(set => set.TargetRpe));
        Assert.Equal(["5", "3"], rdl.Sets.Skip(2).Select(set => set.Rir));
        Assert.DoesNotContain(ready.ReviewIssues!, issue => issue.Code == "rpe_unspecified");
    }

    [Fact]
    public async Task A_nullable_model_day_name_is_replaced_by_the_printed_page_title()
    {
        const string outline = """
            {"programTitle":"Labeled block","chunks":[{"label":"Week 1","block":null,"phase":null,"weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
            """;
        const string content = """
            {"programTitle":"Labeled block","days":[
              {"block":null,"phase":null,"weekNumber":1,"phaseWeek":1,"dayName":null,"isRestDay":false,"notes":null,"sourcePage":1,"exercises":[
                {"sequenceGroup":null,"sourceName":"Barbell bench press","exerciseId":null,"warmupSets":null,"workingSets":"1","substitutions":[],"coachingNotes":null,"notes":null,"sourcePage":1,"sets":[
                  {"repMin":5,"repMax":8,"repsText":"5-8","targetRpe":8,"rir":null,"restSeconds":120,"restText":"2 min","tempo":null,"loadText":null,"notes":null,"repsSource":"extracted","rpeSource":"extracted","restSource":"extracted","sourcePage":1}]}]}]}
            """;
        var responseIndex = 0;
        var bodies = new[] { outline, content };
        var handler = new StubHandler(_ =>
        {
            var body = bodies[Math.Min(responseIndex++, bodies.Length - 1)];
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"status":"completed","usage":{"input_tokens":10,"output_tokens":20},"output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(body)}}}]}]}""")
            };
        });

        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(handler);
        var source = new ImportSourceInput("labels.pdf", 1, [new ImportPageText(1,
            "WEEK 1\nDAY LABEL: LOWER 1\nExercise | Sets | Reps | RPE | Rest\nBarbell bench press | 1 | 5-8 | 8 | 2 min")]);

        var pending = await imports.Create(source, default);
        var ready = await imports.Extract(pending.Id, default);

        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal("Lower 1", Assert.Single(ready.Draft!.Workouts).Name);
        Assert.Contains(ready.ReviewIssues!, issue => issue.Code == "day_name_from_source" && issue.Severity == "info");
    }

    [Fact] public async Task A_chunked_import_preserves_blocks_verbatim_targets_and_accepts_mapped_names()
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
        await h.Seed(new SeedExercise("constant-curl", "Constant-Tension Lying Leg Curl", "Hamstrings", "Machine", "Control the eccentric", null));
        var source = Source("faithful.pdf") with
        {
            Pages = Source("faithful.pdf").Pages.Select(page => page with
            {
                Text = $"BLOCK 1\nBASE HYPERTROPHY\nWEEK 1\nConstant-Tension Lying Leg Curl 3 x 8-12\nBarbell bench press 3 x 8-10 @ RPE 8"
            }).ToList()
        };
        var partial = await imports.Create(source, default);

        Assert.Equal(ImportStatus.Pending, partial.Status);
        Assert.Equal("extract", partial.Stage);
        Assert.Equal(0, partial.ChunksDone);
        Assert.Equal(1, partial.ChunksTotal);
        Assert.Equal(1, (await h.Db.Imports.AsNoTracking().SingleAsync()).Calls);

        var ready = await imports.Extract(partial.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.True(ready.Acceptable);
        Assert.Equal(0, ready.UnresolvedCount);
        Assert.Empty(ready.Unresolved);
        var exercise = ready.Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal("A1", exercise.SequenceGroup);
        Assert.Equal(3, exercise.SourcePage);
        Assert.Equal(["Seated leg curl", "Nordic curl"], exercise.Substitutions);
        Assert.Equal(3, exercise.Sets.Count);
        Assert.All(exercise.Sets.Take(2), set => Assert.True(set.Warmup));
        Assert.All(exercise.Sets.Take(2), set =>
        {
            Assert.Null(set.TargetRpe);
            Assert.Null(set.Rir);
        });
        Assert.False(exercise.Sets[2].Warmup);
        Assert.Equal("AMRAP", exercise.Sets[2].RepsText);
        Assert.Equal("3-5 min", exercise.Sets[2].RestText);
        Assert.Equal("2", exercise.Sets[2].Rir);
        Assert.Equal(8, exercise.Sets[2].TargetRpe);
        Assert.Equal("inferred", exercise.Sets[2].RepsSource);
        // Two AI reads: one outline pass and one chunk. Counted before accepting, because
        // accepting removes the import row.
        Assert.Equal(2, (await h.Db.Imports.AsNoTracking().SingleAsync()).Calls);

        var program = await imports.Accept(ready.Id, default);
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
        Assert.Empty(await h.Db.Imports.AsNoTracking().ToListAsync());
    }

    [Fact] public async Task Pending_imports_from_an_older_prompt_version_are_not_resumed_with_mixed_behavior()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var stub = StubHandler.Program(Outline);
        var imports = h.Imports(stub);
        var pending = await imports.Create(Source("older.pdf"), default);
        var row = await h.Db.Imports.SingleAsync(item => item.Id == pending.Id);
        row.PromptVersion = "workout-import-v11-layout-text";
        await h.Db.SaveChangesAsync();

        var extractionError = await Assert.ThrowsAsync<DomainException>(() => imports.Extract(pending.Id, default));
        Assert.Equal(409, extractionError.Status);
        Assert.Equal(1, stub.Calls);

        row.Stage = "select";
        row.AlternativesJson = Json.Write(new List<ImportAlternative> { new("full-body", "Full Body", 1, 1, []) });
        await h.Db.SaveChangesAsync();
        var selectionError = await Assert.ThrowsAsync<DomainException>(() => imports.SelectAlternative(pending.Id, "full-body", default));
        Assert.Equal(409, selectionError.Status);
        Assert.Equal(1, stub.Calls);
    }

    [Fact] public async Task An_unmatched_exercise_stays_unresolved_and_blocks_acceptance()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var view = await imports.Create(Source("block.pdf"), default);

        Assert.Null(view.Draft!.Workouts.Single().Exercises.Single().ExerciseId);
        Assert.Single(view.Unresolved);
        Assert.False(view.Acceptable);
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Accept(view.Id, default));
        Assert.Equal(409, failure.Status);
        Assert.Empty(await h.Db.Programs.ToListAsync());
    }

    [Fact] public async Task Missing_optional_rpe_or_rest_remain_unspecified_without_blocking_acceptance()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        // The read reports the page states neither value.
        var body = OneWorkout.Replace("\"targetRpe\":8", "\"targetRpe\":null").Replace("\"restSeconds\":120", "\"restSeconds\":null")
            .Replace("\"rpeSource\":\"inferred\"", "\"rpeSource\":\"extracted\"");
        var imports = h.Imports(StubHandler.Program(body));
        var view = await imports.Create(Source("unspecified.pdf"), default);

        Assert.True(view.Acceptable);
        var set = view.Draft!.Workouts.Single().Exercises.Single().Sets.Single();
        Assert.Null(set.TargetRpe);
        Assert.Null(set.RestSeconds);
        Assert.Contains(view.ReviewIssues!, issue => issue.Code == "rpe_unspecified" && issue.Severity == "info");
        Assert.Contains(view.ReviewIssues!, issue => issue.Code == "rest_unspecified" && issue.Severity == "info");

        var accepted = await imports.Accept(view.Id, default);
        Assert.Equal(ProgramLifecycle.Standby, accepted.LifecycleStatus);
    }

    [Fact] public async Task A_target_the_read_could_not_confirm_as_blank_fails_with_a_specific_explanation()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var body = OneWorkout.Replace("\"targetRpe\":8", "\"targetRpe\":null");
        var imports = h.Imports(StubHandler.Program(body));
        var failure = await Assert.ThrowsAsync<ImportVerificationException>(() => imports.Create(Source("unread.pdf"), default));
        Assert.Contains("rpe_unread", failure.Message);
        var failedImport = Assert.Single(await imports.List(default));
        var failed = await imports.Get(failedImport.Id, default);
        Assert.Equal(ImportStatus.Failed, failed.Status);
        Assert.Contains(failed.ReviewIssues!, issue => issue.Code == "rpe_unread" && issue.Severity == "warning");
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
        Assert.Equal(new SetPrescription(8, 10, 8, 120, null, null, null, null, null, "2", false, "extracted", "inferred", "extracted"), workout.Exercises.Single().Sets.Single());
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

    /// A provider failure is retryable and keeps source text so a retry does not need another PDF read.
    [Fact] public async Task A_provider_failure_keeps_the_import_and_source_for_retry()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("{}") }));
        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(Source("block.pdf"), default));

        Assert.NotEmpty(failure.Message);
        var row = Assert.Single(await h.Db.Imports.AsNoTracking().ToListAsync());
        Assert.Equal(ImportStatus.Pending, row.Status);
        Assert.NotEmpty(row.SourceTextJson);
        Assert.NotEmpty(row.Error);
        Assert.Single(await imports.List(default));
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
        var source = Source("choices.pdf");
        source = source with
        {
            Pages = source.Pages.Select(page => page with
            {
                Text = $"WEEK 1\nConstant-Tension Lying Leg Curl 3 x 8-12\n{page.Text}"
            }).ToList()
        };
        var pending = await imports.Create(source, default);
        Assert.Equal("select", pending.Stage);
        Assert.Equal(["Full Body", "Upper/Lower", "Body Part Split"], pending.Alternatives!.Select(option => option.Name));
        var selected = await imports.SelectAlternative(pending.Id, "upper-lower", default);
        Assert.Equal("upper-lower", selected.SelectedAlternativeId);
        Assert.Equal(1, selected.ChunksTotal);
        Assert.Equal("extract", selected.Stage);
        var ready = await imports.Extract(selected.Id, default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.Equal(2, stub.Calls);
    }

    [Fact] public async Task Import_draft_restore_and_exercise_restore()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var ready = await imports.Create(Source("block.pdf"), default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.False(ready.CanRestoreDraft);
        Assert.Empty(ready.RestorableExerciseLineIds!);

        var originalExercise = ready.Draft!.Workouts.Single().Exercises.Single();
        var exerciseLineId = originalExercise.LineId;

        var editedDraft = ready.Draft with
        {
            ProgramName = "Edited Program Name",
            Workouts = [ready.Draft.Workouts.Single() with
            {
                Exercises = [originalExercise with
                {
                    SourceName = "Edited Press",
                    Notes = "My coaching cues",
                    Sets = [originalExercise.Sets[0] with { RepMin = 12, RepMax = 15, RepsSource = "userEdited" }]
                }]
            }]
        };

        var editedView = await imports.Edit(ready.Id, editedDraft, default);
        Assert.True(editedView.CanRestoreDraft);
        Assert.Contains(exerciseLineId, editedView.RestorableExerciseLineIds!);

        var exerciseRestoredView = await imports.RestoreExercise(ready.Id, exerciseLineId, editedView.Revision, default);
        var restoredExercise = exerciseRestoredView.Draft!.Workouts.Single().Exercises.Single();
        Assert.Equal("Barbell bench press", restoredExercise.SourceName);
        Assert.Equal(8, restoredExercise.Sets[0].RepMin);
        Assert.Equal(10, restoredExercise.Sets[0].RepMax);
        Assert.Equal("extracted", restoredExercise.Sets[0].RepsSource);
        Assert.Equal("Edited Program Name", exerciseRestoredView.Draft.ProgramName);
        Assert.DoesNotContain(exerciseLineId, exerciseRestoredView.RestorableExerciseLineIds!);
        Assert.True(exerciseRestoredView.CanRestoreDraft);

        var draftRestoredView = await imports.RestoreDraft(ready.Id, exerciseRestoredView.Revision, default);
        Assert.Equal("Hypertrophy block", draftRestoredView.Draft!.ProgramName);
        Assert.False(draftRestoredView.CanRestoreDraft);
        Assert.Empty(draftRestoredView.RestorableExerciseLineIds!);

        var ex = await Assert.ThrowsAsync<DomainException>(() => imports.RestoreDraft(ready.Id, 1, default));
        Assert.Equal(409, ex.Status);
    }

    [Fact] public async Task Import_week_sorting_and_structural_changes_trigger_draft_restorability()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        const string twoWorkouts = """
        {"programName":"Hypertrophy block","weeks":[
          {"week":1,"workouts":[{"name":"Day 1","focus":"Push","notes":null,"exercises":[
            {"sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sets":[
              {"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,
               "repsSource":"extracted","rpeSource":"inferred","restSource":"extracted"}]}]}]},
          {"week":2,"workouts":[{"name":"Day 2","focus":"Pull","notes":null,"exercises":[
            {"sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sets":[
              {"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,
               "repsSource":"extracted","rpeSource":"inferred","restSource":"extracted"}]}]}]}
        ]}
        """;
        var imports = h.Imports(StubHandler.Program(twoWorkouts));
        var ready = await imports.Create(Source("block.pdf"), default);
        Assert.Equal(ImportStatus.Ready, ready.Status);
        Assert.False(ready.CanRestoreDraft);

        // Reorder weeks: swap week 1 and week 2
        var reorderedDraft = ready.Draft! with
        {
            Workouts = [
                ready.Draft.Workouts[1] with { Week = 1, PhaseWeek = 1 },
                ready.Draft.Workouts[0] with { Week = 2, PhaseWeek = 2 }
            ]
        };

        var editedView = await imports.Edit(ready.Id, reorderedDraft, default);
        Assert.True(editedView.CanRestoreDraft);

        var restored = await imports.RestoreDraft(ready.Id, editedView.Revision, default);
        Assert.False(restored.CanRestoreDraft);
        Assert.Equal(ready.Draft.Workouts[0].LineId, restored.Draft!.Workouts[0].LineId);
    }
}
