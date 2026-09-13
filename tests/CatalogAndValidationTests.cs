using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class CatalogAndValidationTests
{
    [Fact] public async Task A_new_database_ships_with_no_exercises()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        Assert.Empty(await h.Catalog.All(default));
        Assert.Equal(0, await h.Db.Exercises.CountAsync());
    }

    [Fact] public async Task Seeding_the_same_file_twice_updates_rather_than_duplicates()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        SeedExercise[] file = [new("bench", "Bench press", "Chest", "Barbell", "Cue", ["bench press", "bp"])];
        await h.Seed(file);
        await h.Seed(file);
        Assert.Equal(1, await h.Db.Exercises.CountAsync());
        Assert.Equal(2, await h.Db.Aliases.CountAsync());
    }

    [Fact] public async Task Reseeding_updates_an_existing_exercise_in_place_and_leaves_others_alone()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Old cue", null), new SeedExercise("squat", "Back squat", "Quads", "Barbell", "Cue", null));
        var id = await h.ExerciseId("bench");
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "New cue", null));
        var bench = await h.Db.Exercises.AsNoTracking().SingleAsync(x => x.Slug == "bench");
        Assert.Equal(id, bench.Id);
        Assert.Equal("Barbell bench press", bench.Name);
        Assert.Equal("New cue", bench.Cue);
        // An exercise the new file omits is untouched, not removed.
        Assert.True((await h.Db.Exercises.AsNoTracking().SingleAsync(x => x.Slug == "squat")).Active);
    }

    [Fact] public async Task Deactivate_missing_retires_exercises_the_file_omits()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null), new SeedExercise("squat", "Back squat", "Quads", "Barbell", "Cue", null));
        h.Db.CurrentUser = null;
        await CatalogSeed.Apply(h.Db, [new("bench", "Bench press", "Chest", "Barbell", "Cue", null)], deactivateMissing: true, default);
        h.Db.ChangeTracker.Clear();
        Assert.False((await h.Db.Exercises.AsNoTracking().SingleAsync(x => x.Slug == "squat")).Active);
        Assert.Single(await h.Catalog.All(default));
    }

    [Fact] public async Task A_seed_file_that_repeats_a_slug_is_rejected_whole()
    {
        await using var h = await Harness.Create();
        h.Db.CurrentUser = null;
        await Assert.ThrowsAsync<DomainException>(() => CatalogSeed.Apply(h.Db,
            [new("bench", "Bench press", "Chest", "Barbell", "Cue", null), new("bench", "Repeat", "Chest", "Barbell", "Cue", null)], false, default));
        Assert.Equal(0, await h.Db.Exercises.CountAsync());
    }

    [Fact] public async Task Aliases_match_regardless_of_case_and_punctuation()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", ["Flat BB Bench"]));
        var id = await h.ExerciseId("bench");
        Assert.Equal(id, await h.Catalog.Match("flat bb bench", default));
        Assert.Equal(id, await h.Catalog.Match("  Barbell   Bench-Press  ", default));
        Assert.Null(await h.Catalog.Match("leg press", default));
    }

    [Theory]
    [InlineData(8)] [InlineData(7.5)] [InlineData(1)] [InlineData(10)]
    public void An_RPE_on_a_half_point_is_accepted(double value) => Validation.Rpe(value);

    [Theory]
    [InlineData(0.5)] [InlineData(10.5)] [InlineData(7.3)] [InlineData(8.25)]
    public void An_RPE_off_the_half_point_scale_is_refused(double value) => Assert.Throws<DomainException>(() => Validation.Rpe(value));

    [Fact] public void A_completed_set_needs_reps_and_an_RPE()
    {
        Assert.Throws<DomainException>(() => Validation.LoggedSet(60, null, 8, done: true));
        Assert.Throws<DomainException>(() => Validation.LoggedSet(60, 10, null, done: true));
        Validation.LoggedSet(60, 10, 8, done: true);
    }

    [Fact] public void An_unfinished_set_may_leave_reps_and_RPE_blank()
        => Validation.LoggedSet(null, null, null, done: false);

    [Fact] public void A_zero_weight_is_a_real_bodyweight_set_and_null_stays_unknown()
    {
        Validation.LoggedSet(0, 10, 8, done: true);
        Validation.LoggedSet(null, 10, 8, done: true);
    }

    [Fact] public void A_rep_range_must_run_upwards()
    {
        Assert.Throws<DomainException>(() => Validation.Prescriptions([new(12, 8, 8, null, null, null, null)]));
        Validation.Prescriptions([new(8, 12, 8, null, null, null, null)]);
    }

    [Fact] public void An_exercise_needs_at_least_one_set()
        => Assert.Throws<DomainException>(() => Validation.Prescriptions([]));

    [Fact] public void Set_prescriptions_survive_a_round_trip_with_their_differences_intact()
    {
        List<SetPrescription> sets = [new(8, 10, 8, 120, "3010", "70% 1RM", "top set"), new(12, 12, 7.5, null, null, null, null)];
        var parsed = Validation.Prescriptions(Json.Write(sets));
        Assert.Equal(sets, parsed);
        Assert.Equal(10, parsed[0].RepMax);
        Assert.Equal(12, parsed[1].RepMin);
    }
}
