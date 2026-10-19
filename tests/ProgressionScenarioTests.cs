using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Progression situations that once left a set stuck or blank: effort that was never recorded,
/// equipment steps too large for the rep range, high-rep work, and history the policy could
/// not match to the set being planned.
public sealed class ProgressionScenarioTests
{
    private static SetExposure Done(double load, int reps, string? rir, int daysAgo, int min, int max, string? targetRir = "2")
        => new(Guid.NewGuid(), DateTime.UtcNow.AddDays(-daysAgo), load, reps, Progression.RpeFromRir(rir), null,
            ResistanceModes.External, rir, min, max, null, targetRir, HasPrescription: true);

    private static SetPrescription Plan(int min, int max, string? rir = "2") => new(min, max, null, 90, null, null, null, Rir: rir);

    [Fact]
    public void Unrated_sets_at_the_top_of_the_range_still_earn_the_next_step_when_the_program_sets_an_effort()
    {
        // RIR tracking off: nothing is recorded, so the sets are taken to have met their target.
        var result = Progression.Suggest(Plan(8, 10), [Done(80, 10, null, 2, 8, 10), Done(80, 10, null, 5, 8, 10)],
            ProgressionModes.Normal, new LoadOptions(2.5), now: DateTime.UtcNow);
        Assert.Equal(82.5, result.SuggestedLoadKg);
        Assert.Equal(8, result.SuggestedReps);
    }

    [Fact]
    public void A_new_rep_range_reselects_the_load_from_unrated_sets_read_at_their_own_target()
    {
        // Week 2 of a block moves 8-10 at 2 RIR to 6-8 at 1 RIR; nothing was rated.
        var result = Progression.Suggest(Plan(6, 8, "1"), [Done(60, 10, null, 7, 8, 10)], ProgressionModes.Normal,
            new LoadOptions(2.5), now: DateTime.UtcNow);
        Assert.Equal(67.5, result.SuggestedLoadKg);
        Assert.Equal(6, result.SuggestedReps);
        Assert.Contains("Prescription changed", result.Reason);
    }

    [Fact]
    public void A_step_too_large_for_the_range_is_bridged_with_reps_past_the_top()
    {
        var stack = new LoadOptions(0, AvailableLoadsKg: [20, 27, 34, 41, 48]);
        var result = Progression.Suggest(Plan(12, 15), [Done(34, 15, "2", 2, 12, 15)], ProgressionModes.Normal, stack,
            now: DateTime.UtcNow);
        Assert.Equal(34, result.SuggestedLoadKg);
        Assert.Equal(16, result.SuggestedReps);
        Assert.Contains("past the range", result.Reason);

        // Once the extra reps make the jump reachable, the next weight is taken for the lower reps it allows.
        var reached = Progression.Suggest(Plan(12, 15), [Done(34, 17, "2", 2, 12, 15), Done(34, 16, "2", 5, 12, 15)],
            ProgressionModes.Normal, stack, now: DateTime.UtcNow);
        Assert.Equal(41, reached.SuggestedLoadKg);
        Assert.True(reached.SuggestedReps is >= 8 and < 12);
        Assert.True(reached.IsRepRangeTransition);
    }

    [Fact]
    public void A_step_no_bounded_rep_bridge_can_reach_says_so_instead_of_holding_silently()
    {
        var result = Progression.Suggest(Plan(6, 8), [Done(40, 8, "3", 2, 6, 8)], ProgressionModes.Normal, new LoadOptions(10),
            now: DateTime.UtcNow);
        Assert.Equal(40, result.SuggestedLoadKg);
        Assert.Equal(8, result.SuggestedReps);
        Assert.Contains("smaller increment", result.Reason);
    }

    [Fact]
    public void High_rep_sets_beyond_the_estimate_still_take_a_small_step_at_the_top_of_the_range()
    {
        var result = Progression.Suggest(Plan(25, 30), [Done(40, 30, "2", 2, 25, 30)], ProgressionModes.Normal, new LoadOptions(2.5),
            now: DateTime.UtcNow);
        Assert.Equal(42.5, result.SuggestedLoadKg);
        Assert.Equal(25, result.SuggestedReps);
    }

    [Fact]
    public void The_heaviest_available_weight_is_named_rather_than_called_unestimable()
    {
        var result = Progression.Suggest(Plan(8, 10), [Done(48, 10, "2", 2, 8, 10)], ProgressionModes.Normal,
            new LoadOptions(0, AvailableLoadsKg: [34, 41, 48]), now: DateTime.UtcNow);
        Assert.Equal(48, result.SuggestedLoadKg);
        Assert.Contains("heaviest available weight", result.Reason);
    }

    [Fact]
    public void A_session_that_trained_the_movement_twice_is_read_as_the_row_prescribed_like_the_set()
    {
        var session = Guid.NewGuid();
        var top = Done(100, 5, "2", 2, 3, 5) with { SessionId = session };
        var backOff = Done(80, 10, "2", 2, 8, 10) with { SessionId = session };
        var result = Progression.Suggest(Plan(8, 10), [top, backOff], ProgressionModes.Normal, new LoadOptions(2.5),
            now: DateTime.UtcNow);
        Assert.Equal(82.5, result.SuggestedLoadKg);
        Assert.Equal(80, result.PreviousLoadKg);
    }

    [Fact]
    public void A_back_off_set_with_no_matching_row_reads_the_closest_row_rather_than_the_top_set()
    {
        // The back-off row's effort target changed since last time, so neither row matches exactly;
        // the back-off row is still the one prescribed like today's set.
        var session = Guid.NewGuid();
        var top = Done(80, 5, "2", 7, 5, 5) with { SessionId = session };
        var backOff = Done(72.5, 8, "3", 7, 8, 8, targetRir: "3") with { SessionId = session };
        var result = Progression.Suggest(Plan(8, 8, rir: null), [top, backOff], ProgressionModes.Normal, new LoadOptions(2.5),
            now: DateTime.UtcNow);
        Assert.Equal(72.5, result.PreviousLoadKg);
        Assert.Equal(8, result.PreviousReps);
    }

    private static async Task<Guid> Exercise(Harness h, string slug, string name, string equipment, string? tracking = null)
    {
        await h.Seed(new SeedExercise(slug, name, "Back", equipment, null, 2.5, TrackingMode: tracking));
        return await h.ExerciseId(slug);
    }

    private static async Task Finish(Harness h, SessionView session, Func<SessionExerciseView, int, SetInput> log)
    {
        await h.Workouts.Save(session.Id, new SessionInput(null, session.Exercises.Select(exercise =>
            new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                exercise.Sets.Select((set, index) => log(exercise, index) with { Id = set.Id }).ToList(), Id: exercise.Id)).ToList(),
            session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
    }

    [Fact]
    public async Task A_set_the_program_adds_starts_from_the_set_before_it()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var id = await Exercise(h, "row", "Row", "Barbell");
        var three = await h.Templates.Create(Harness.Template("Pull", Harness.Exercise(id, "Row", Harness.Set(8, 10), Harness.Set(8, 10), Harness.Set(8, 10))), null, 1, 0, default);
        await Finish(h, await h.Workouts.Start(three.Id, null, default), (_, _) => new SetInput(60, 9, 8, true, Rir: "2"));

        var four = await h.Templates.Create(Harness.Template("Pull+", Harness.Exercise(id, "Row", Harness.Set(8, 10), Harness.Set(8, 10), Harness.Set(8, 10), Harness.Set(8, 10))), null, 1, 0, default);
        var sets = (await h.Workouts.Start(four.Id, null, default)).Exercises.Single().Sets;
        Assert.Equal(60, sets[3].WeightKg);
        Assert.Equal(sets[2].Reps, sets[3].Reps);
        Assert.NotNull(sets[3].Suggestion!.SourceSessionId);
        Assert.Contains("added since last time", sets[3].Suggestion!.Reason);
    }

    [Fact]
    public async Task A_top_set_and_back_off_rows_of_one_lift_progress_from_their_own_rows()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var id = await Exercise(h, "bench", "Bench Press", "Barbell");
        var template = await h.Templates.Create(Harness.Template("Push",
            Harness.Exercise(id, "Bench Press", Harness.Set(3, 5)), Harness.Exercise(id, "Bench Press", Harness.Set(8, 10))), null, 1, 0, default);
        await Finish(h, await h.Workouts.Start(template.Id, null, default),
            (exercise, _) => exercise.Prescription[0].RepMin == 3 ? new SetInput(100, 5, 8, true, Rir: "2") : new SetInput(80, 10, 8, true, Rir: "2"));

        var next = await h.Workouts.Start(template.Id, null, default);
        var topSet = next.Exercises[0].Sets.Single();
        var backOff = next.Exercises[1].Sets.Single();
        Assert.Equal(100, topSet.Suggestion!.PreviousLoadKg);
        Assert.Equal(80, backOff.Suggestion!.PreviousLoadKg);
        Assert.True(backOff.WeightKg > 80);
        Assert.DoesNotContain("Prescription changed", backOff.Suggestion.Reason);
    }

    [Fact]
    public async Task A_loaded_hold_starts_from_its_last_weight_while_a_bodyweight_hold_has_none()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var walk = await Exercise(h, "farmers-walk", "Farmer's Walk", "Dumbbell", TrackingModes.Duration);
        var template = await h.Templates.Create(Harness.Template("Carry", Harness.Exercise(walk, "Farmer's Walk", Harness.Set(1, 1), Harness.Set(1, 1))),
            null, 1, 0, default);
        await Finish(h, await h.Workouts.Start(template.Id, null, default),
            (_, index) => new SetInput(index == 0 ? 32 : 30, null, null, true, DurationSeconds: 40));

        var sets = (await h.Workouts.Start(template.Id, null, default)).Exercises.Single().Sets;
        Assert.Equal(32, sets[0].WeightKg);
        Assert.Equal(30, sets[1].WeightKg);
        Assert.All(sets, set => Assert.Null(set.Reps));
        Assert.All(sets, set => Assert.False(set.Done));
    }

    [Fact]
    public async Task A_loaded_hold_in_a_second_row_reads_its_own_row_and_never_climbs()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var walk = await Exercise(h, "farmers-walk", "Farmer's Walk", "Dumbbell", TrackingModes.Duration);
        var template = await h.Templates.Create(Harness.Template("Carry",
            Harness.Exercise(walk, "Farmer's Walk", Harness.Set(20, 20)),
            Harness.Exercise(walk, "Farmer's Walk", Harness.Set(45, 45), Harness.Set(45, 45))), null, 1, 0, default);
        // A heavy short carry, then two longer ones whose second was (oddly) heavier.
        await Finish(h, await h.Workouts.Start(template.Id, null, default), (exercise, index) =>
            new SetInput(exercise.Prescription[0].RepMin == 20 ? 40 : index == 0 ? 24 : 28, null, null, true, DurationSeconds: 40));

        var next = await h.Workouts.Start(template.Id, null, default);
        Assert.Equal(40, next.Exercises[0].Sets.Single().WeightKg);
        var longer = next.Exercises[1].Sets;
        // Its first set reads the longer row, not the heavy first row of the session.
        Assert.Equal(24, longer[0].WeightKg);
        Assert.Equal(24, longer[1].WeightKg);
    }
}
