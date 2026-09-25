using System.Text.Json;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class WatchSetRirTests
{
    [Fact]
    public async Task Watch_set_patches_store_matching_rir_and_rpe_and_preserve_five_plus()
    {
        var harness = await Ready();
        await using var _ = harness;
        var template = await CreateTemplate(harness);
        var session = await harness.Workouts.Start(template, null, default);
        var exercise = Assert.Single(session.Exercises);
        var first = exercise.Sets[0];
        using var precise = JsonDocument.Parse($$"""
            {"revision":{{session.Revision}},"mutationId":"{{Guid.NewGuid()}}","weightKg":60,"reps":9,"rpe":8,"rir":"2","done":true}
            """);
        var afterPrecise = await harness.Workouts.PatchSet(session.Id, first.Id, precise.RootElement.Clone(), default);
        var savedPrecise = afterPrecise.Exercises.Single().Sets.Single(set => set.Id == first.Id);
        Assert.Equal("2", savedPrecise.Rir);
        Assert.Equal(8, savedPrecise.Rpe);

        var second = afterPrecise.Exercises.Single().Sets[1];
        using var fivePlus = JsonDocument.Parse($$"""
            {"revision":{{afterPrecise.Revision}},"mutationId":"{{Guid.NewGuid()}}","reps":10,"rpe":null,"rir":"5+","done":true}
            """);
        var afterFivePlus = await harness.Workouts.PatchSet(session.Id, second.Id, fivePlus.RootElement.Clone(), default);
        var savedFivePlus = afterFivePlus.Exercises.Single().Sets.Single(set => set.Id == second.Id);
        Assert.Equal("5+", savedFivePlus.Rir);
        Assert.Null(savedFivePlus.Rpe);
    }

    [Fact]
    public async Task Set_patch_rejects_unknown_rir_and_mismatched_rpe()
    {
        var harness = await Ready();
        await using var _ = harness;
        var template = await CreateTemplate(harness);
        var session = await harness.Workouts.Start(template, null, default);
        var set = session.Exercises.Single().Sets[0];

        using var invalid = JsonDocument.Parse($$"""
            {"revision":{{session.Revision}},"mutationId":"{{Guid.NewGuid()}}","reps":9,"rpe":8,"rir":"6","done":true}
            """);
        var invalidFailure = await Assert.ThrowsAsync<DomainException>(() => harness.Workouts.PatchSet(session.Id, set.Id, invalid.RootElement.Clone(), default));
        Assert.Equal(400, invalidFailure.Status);

        using var mismatch = JsonDocument.Parse($$"""
            {"revision":{{session.Revision}},"mutationId":"{{Guid.NewGuid()}}","reps":9,"rpe":9,"rir":"2","done":true}
            """);
        var mismatchFailure = await Assert.ThrowsAsync<DomainException>(() => harness.Workouts.PatchSet(session.Id, set.Id, mismatch.RootElement.Clone(), default));
        Assert.Equal(400, mismatchFailure.Status);
    }

    private static async Task<Harness> Ready()
    {
        var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        return harness;
    }

    private static async Task<Guid> CreateTemplate(Harness harness)
    {
        var exerciseId = await harness.ExerciseId("bench");
        var template = await harness.Templates.Create(
            Harness.Template("Watch RIR", Harness.Exercise(exerciseId, "Bench press", Harness.Set(8, 10), Harness.Set(8, 10))),
            null, 1, 0, default);
        return template.Id;
    }
}
