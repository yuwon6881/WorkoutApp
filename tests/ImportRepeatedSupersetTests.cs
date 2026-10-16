using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportRepeatedSupersetTests
{
    [Fact]
    public async Task Repeated_printed_group_labels_become_distinct_ordered_pairs()
    {
        // Min-Max Phase 2 5x/week PDF p.30 prints S1/S1, S2/S2, S3/S3.
        const string source = """
            === PAGE 30 ===
            DAY LABEL: Arms
            Exercise | Working Sets | Reps | RPE | Rest | Notes
            S1: EZ-Bar Cheat Curl | 2 | 4-6 | 9 | - | Control the negative.
            S1: EZ-Bar Skull Crusher | 2 | 6-8 | 9 | 30-60 sec | Pause in the stretch.
            S2: Preacher Hammer Curl | 2 | 6-8 | 9 | - | Smooth reps.
            S2: Triceps Pressdown | 2 | 4-6 | 9 | 30-60 sec | Use a rope or bar.
            S3: DB Wrist Curl | 2 | 10-12 | 9 | - | Smooth reps.
            S3: DB Wrist Extension | 2 | 10-12 | 9 | 30-60 sec | Smooth reps.
            """;
        var read = new AiProgram("Min-Max", [new AiDay(null, null, 1, 1, "Arms", false, null, [], 30)]);
        var result = ImportTableEvidence.Enrich(read, source);
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var draft = await harness.Imports(StubHandler.Program("{}")).ToDraft(result, default);
        var exercises = draft.Workouts.Single(day => !day.IsRestDay).Exercises;
        Assert.Equal(["A1", "A2", "B1", "B2", "C1", "C2"], exercises.Select(e => e.SequenceGroup));
        for (var index = 0; index < exercises.Count; index++)
            Assert.Contains($"Printed superset group: S{index / 2 + 1}.", exercises[index].Notes);
        Assert.Equal(Json.Write(result), Json.Write(ImportTableEvidence.Enrich(result, source)));
    }

    [Fact]
    public void Existing_member_tags_keep_their_group_when_a_repeated_label_is_present()
    {
        const string source = """
            === PAGE 1 ===
            DAY LABEL: Upper
            Exercise | Sets | Reps | RPE | Rest
            A1: Cable Flye | 2 | 10 | 9 | 0 min
            A2: Cable Row | 2 | 10 | 9 | 1 min
            S1: Bicep Curl | 2 | 10 | 9 | 0 min
            S1: Triceps Pressdown | 2 | 10 | 9 | 1 min
            """;
        var read = new AiProgram("Program", [new AiDay(null, null, 1, 1, "Upper", false, null, [], 1)]);
        var result = ImportTableEvidence.Enrich(read, source);
        Assert.Equal(["A1", "A2", "B1", "B2"], result.Days!.Single().Exercises.Select(e => e.SequenceGroup));
    }

    [Fact]
    public void Reused_member_tags_start_a_new_pair_instead_of_pairing_equal_numbers()
    {
        // Powerbuilding 2.0 4x/week p.60 repeats A1/A2 for two separate supersets.
        const string source = """
            === PAGE 60 ===
            DAY LABEL: Lower 1
            Exercise | Sets | Reps | RPE | Rest
            A1: Sissy Squat | 2 | 10-12 | 8 | 0 min
            A2: Nordic Ham Curl | 2 | 6-8 | 8 | 2-3 min
            A1: Cable Crunch | 3 | 12-15 | 8 | 0 min
            A2: Cable Shrug-In | 3 | 12-15 | 8 | 1-2 min
            """;
        var result = ImportTableEvidence.Enrich(new AiProgram("Program", [new AiDay(null, null, 1, 1, "Lower 1", false, null, [], 60)]), source);
        var exercises = result.Days!.Single().Exercises;
        Assert.Equal(["A1", "A2", "B1", "B2"], exercises.Select(e => e.SequenceGroup));
        Assert.Contains("Printed superset member: A1.", exercises[2].CoachingNotes);
        Assert.Equal(Json.Write(result), Json.Write(ImportTableEvidence.Enrich(result, source)));
    }
}
