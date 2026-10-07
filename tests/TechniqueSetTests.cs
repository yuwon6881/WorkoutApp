using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Partials, myo-reps and drop sets are real work but not straight-set strength: they never set
/// records or move the strength trend, and progression keeps them apart from straight sets.
public sealed class TechniqueSetTests
{
    [Theory]
    [InlineData("Myo-reps", SetTechniques.MyoReps)]
    [InlineData("Last set — Myoreps", SetTechniques.MyoReps)]
    [InlineData("Lengthened partials", SetTechniques.LengthenedPartials)]
    [InlineData("Long-length partials", SetTechniques.LengthenedPartials)]
    [InlineData("Integrated partials", SetTechniques.IntegratedPartials)]
    [InlineData("Partial reps (top half)", SetTechniques.Partials)]
    [InlineData("Dropset", SetTechniques.DropSet)]
    [InlineData("DROP SET. DROP WEIGHT BY ~50%", SetTechniques.DropSet)]
    [InlineData("To failure / AMRAP", null)]
    [InlineData("Pause 1 second at the bottom", null)]
    [InlineData(null, null)]
    public void Techniques_are_read_from_the_set_notes(string? notes, string? expected)
    {
        Assert.Equal(expected, SetTechniques.Of(new SetPrescription(8, 10, 8, 90, null, null, notes)));
    }

    [Fact]
    public void A_warm_up_has_no_technique_and_an_unreadable_snapshot_counts_every_set()
    {
        Assert.Null(SetTechniques.Of(new SetPrescription(8, 10, null, null, null, null, "Myo-reps", Warmup: true)));
        var techniques = SetTechniques.ByPosition("not json");
        Assert.True(SetTechniques.IsStrengthEvidence(techniques, 0));
    }

    [Fact]
    public void A_set_learns_only_from_history_done_the_same_way()
    {
        var straight = new SetExposure(Guid.NewGuid(), DateTime.UtcNow.AddDays(-2), 50, 10, 8, RepMin: 8, RepMax: 10,
            TargetRpe: 8, HasPrescription: true);
        var myo = straight with { SessionId = Guid.NewGuid(), CompletedAt = DateTime.UtcNow.AddDays(-1), Reps = 25, Rpe = 10,
            Technique = SetTechniques.MyoReps };
        var loads = new LoadOptions(2.5);

        var plain = Progression.Suggest(Harness.Set(8, 10), [myo, straight], ProgressionModes.Normal, loads);
        Assert.Equal(straight.SessionId, plain.SourceSessionId);

        var technique = Progression.Suggest(Harness.Set(8, 10) with { Notes = "Myo-reps" }, [myo, straight],
            ProgressionModes.Normal, loads);
        Assert.Equal(myo.SessionId, technique.SourceSessionId);
    }

    [Fact]
    public async Task A_last_set_technique_follows_the_straight_load_and_never_sets_a_record()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("curl", "Curl", "Biceps", "Dumbbell", null, 2.5));
        var id = await h.ExerciseId("curl");
        var template = await h.Templates.Create(Harness.Template("Arms", Harness.Exercise(id, "Curl",
            Harness.Set(8, 10), Harness.Set(8, 10), Harness.Set(8, 10) with { Notes = "Lengthened partials" })), null, 1, 0, default);

        // Two straight sets at their target, then partials that pile on reps at the same load.
        var first = await h.Workouts.Start(template.Id, null, default);
        await Log(h, first, (50, 10, 8), (50, 10, 8), (50, 30, 10));

        var next = await h.Workouts.Start(template.Id, null, default);
        var exercise = next.Exercises.Single();
        var straightLoad = exercise.Sets[1].WeightKg;
        Assert.NotNull(straightLoad);
        Assert.Equal(straightLoad, exercise.Sets[2].WeightKg);
        Assert.StartsWith("Technique set", exercise.Sets[2].Suggestion!.Reason);
        Assert.Equal(8, exercise.Sets[2].Reps);

        // The 30-rep partial set is not the rep best to beat, and its estimate is not the strength best.
        var record = Assert.Single(exercise.PreviousRepRecords!);
        Assert.Equal(10, record.Reps);
        Assert.Equal(Progression.Estimate1Rm(50, 10, 8)!.Value, exercise.PreviousBestE1rmKg!.Value, 3);

        // Beating the partial set's rep count at the same load, with partials again, is not a record.
        await Log(h, next, (50, 10, 8), (50, 10, 8), (50, 35, 10));
        var saved = await h.Workouts.Get(next.Id, default);
        Assert.DoesNotContain(saved.Exercises.Single().Sets, set => set.IsPr);
    }

    [Fact]
    public async Task A_technique_set_keeps_its_own_load_when_the_straight_sets_have_none_yet()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("curl", "Curl", "Biceps", "Dumbbell", null, 2.5));
        var id = await h.ExerciseId("curl");
        var partials = Harness.Set(8, 10) with { Notes = "Lengthened partials" };
        var allPartials = await h.Templates.Create(Harness.Template("Partials", Harness.Exercise(id, "Curl",
            partials, partials, partials)), null, 1, 0, default);
        var mixed = await h.Templates.Create(Harness.Template("Mixed", Harness.Exercise(id, "Curl",
            Harness.Set(8, 10), Harness.Set(8, 10), partials)), null, 1, 0, default);

        await Log(h, await h.Workouts.Start(allPartials.Id, null, default), (40, 12, 9), (40, 12, 9), (40, 12, 9));

        // The straight sets have never been done, so they have no load to hand on; the partial set
        // still knows the 40 kg it used rather than starting blank.
        var exercise = (await h.Workouts.Start(mixed.Id, null, default)).Exercises.Single();
        Assert.Null(exercise.Sets[1].WeightKg);
        Assert.Equal(40, exercise.Sets[2].WeightKg);
    }

    [Fact]
    public async Task A_first_technique_only_session_starts_from_the_straight_set_load()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("pulldown", "Lat Pulldown", "Lats", "Machine", null, 2.5));
        var id = await h.ExerciseId("pulldown");
        var straight = await h.Templates.Create(Harness.Template("Straight", Harness.Exercise(id, "Lat Pulldown",
            Harness.Set(8, 10), Harness.Set(8, 10))), null, 1, 0, default);
        var partials = Harness.Set(8, 10) with { Notes = "Lengthened partials" };
        var allPartials = await h.Templates.Create(Harness.Template("Partials", Harness.Exercise(id, "Lat Pulldown",
            partials, partials)), null, 1, 0, default);

        await Log(h, await h.Workouts.Start(straight.Id, null, default), (60, 9, 8), (60, 9, 8));

        // Partials have never been done on this movement: the known straight-set load is the start,
        // not a blank "first time through".
        var exercise = (await h.Workouts.Start(allPartials.Id, null, default)).Exercises.Single();
        Assert.Equal(60, exercise.Sets[0].WeightKg);
        Assert.StartsWith("Technique set", exercise.Sets[0].Suggestion!.Reason);
        Assert.Equal(60, exercise.Sets[1].WeightKg);
    }

    private static async Task Log(Harness h, SessionView session, params (double Load, int Reps, double Rpe)[] performed)
    {
        var exercise = Assert.Single(session.Exercises);
        var sets = exercise.Sets.Select((set, index) => new SetInput(performed[index].Load, performed[index].Reps,
            performed[index].Rpe, true, Id: set.Id)).ToList();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription, sets, Id: exercise.Id)],
            session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
    }
}

public sealed class ImportRomRepTotalsTests
{
    private const string TwentyOnes = "FIRST 7 REPS BOTTOM HALF OF ROM, NEXT 7 REPS TOP HALF OF ROM, LAST 7 REPS FULL ROM";

    [Theory]
    [InlineData(TwentyOnes, "7/7/7", 21)]
    [InlineData(TwentyOnes, "7+7+7", 21)]
    [InlineData(TwentyOnes, "10", 7)]
    [InlineData(TwentyOnes, "6/6/6", 7)]
    [InlineData("DROPSET. DROP WEIGHT BY ~50% ON SECOND 15 REPS.", "15/15", 7)]
    public void Printed_rom_segments_become_one_whole_set_target(string notes, string repsText, int expected)
    {
        var set = new DraftSet(7, 7, 7, 90, null, null, "Partial reps", RepsText: repsText);
        var exercise = new DraftExercise(Guid.NewGuid(), "EZ Bar Curl 21s", null, notes,
            [set with { Warmup = true, RepMin = null, RepMax = null, RepsText = null }, set]);
        var draft = new ImportDraft("Program", [new DraftWorkout(Guid.NewGuid(), 5, "Day 5", null, null, [exercise])]);

        var totalled = ImportRomRepTotals.Apply(draft).Workouts[0].Exercises[0];

        Assert.Equal(expected, totalled.Sets[1].RepMin);
        Assert.Equal(expected, totalled.Sets[1].RepMax);
        Assert.Equal(repsText, totalled.Sets[1].RepsText);
        Assert.Null(totalled.Sets[0].RepMin);
    }

    [Fact]
    public void Matching_segments_are_settled_but_a_printed_count_that_disagrees_still_asks_for_review()
    {
        var matching = new DraftExercise(Guid.NewGuid(), "EZ Bar Curl 21s", null, TwentyOnes,
            [new DraftSet(7, 7, 7, 90, null, null, "Partial reps", RepsText: "7/7/7")]);
        // Weeks 6-8 of the source print "10" under the same note: a defect in the PDF that the
        // reviewer must see on every import, not one the reader quietly rewrites.
        var defective = matching with
        {
            LineId = Guid.NewGuid(),
            Sets = [new DraftSet(10, 10, 7, 90, null, null, "Partial reps", RepsText: "10")]
        };
        var draft = ImportRomRepTotals.Apply(new ImportDraft("Program", [
            new DraftWorkout(Guid.NewGuid(), 5, "Day 5", null, null, [matching]),
            new DraftWorkout(Guid.NewGuid(), 6, "Day 5", null, null, [defective])]));

        var conflict = Assert.Single(ImportValidation.ReviewIssues(draft), issue => issue.Code == "rep_technique_conflict");
        Assert.Equal(defective.LineId, conflict.ExerciseLineId);
        Assert.Equal(10, draft.Workouts[1].Exercises[0].Sets[0].RepMin);
    }
}
