using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class AuthAndTenancyTests
{
    [Fact] public async Task One_account_cannot_read_another_accounts_training()
    {
        await using var h = await Harness.Create();
        var alice = await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        var template = await h.Templates.Create(Harness.Template("Push", Harness.Exercise(await h.ExerciseId("bench"), "Bench press", Harness.Set(8, 10))), null, 1, 0, default);

        var bob = await h.CreateUser("bob");
        h.Db.ChangeTracker.Clear();
        h.Db.CurrentUser = bob.Id;
        Assert.Empty(await h.Templates.List(null, true, default));
        var failure = await Assert.ThrowsAsync<DomainException>(() => h.Templates.Get(template.Id, default));
        Assert.Equal(404, failure.Status);
        Assert.NotEqual(alice.Id, bob.Id);
    }

    [Fact] public async Task Writing_a_record_owned_by_another_account_is_refused()
    {
        await using var h = await Harness.Create();
        var alice = await h.SignIn();
        var bob = await h.CreateUser("bob");
        h.Db.CurrentUser = bob.Id;
        h.Db.Templates.Add(new WorkoutTemplate { UserId = alice.Id, Name = "Stolen" });
        await Assert.ThrowsAsync<InvalidOperationException>(() => h.Db.SaveChangesAsync());
    }

    [Fact] public async Task The_exercise_catalog_is_read_only_outside_the_seed_command()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        h.Db.Exercises.Add(new Exercise { Slug = "sneaky", Name = "Sneaky lift" });
        var failure = await Assert.ThrowsAsync<InvalidOperationException>(() => h.Db.SaveChangesAsync());
        Assert.Contains("read-only", failure.Message);
    }

    [Fact] public async Task The_seeded_catalog_is_shared_and_cannot_be_deleted_by_an_account()
    {
        await using var h = await Harness.Create();
        var alice = await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "", null));
        Assert.Single(await h.Catalog.All(default));

        var bob = await h.CreateUser("bob");
        h.Db.ChangeTracker.Clear();
        h.Db.CurrentUser = bob.Id;
        Assert.Equal("Bench press", (await h.Catalog.All(default)).Single().Name);

        h.Db.Exercises.Remove(await h.Db.Exercises.SingleAsync(x => x.Slug == "bench"));
        var failure = await Assert.ThrowsAsync<InvalidOperationException>(() => h.Db.SaveChangesAsync());
        Assert.Contains("read-only", failure.Message);
        Assert.NotEqual(alice.Id, bob.Id);
    }
}
