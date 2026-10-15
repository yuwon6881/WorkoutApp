using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class EffortPrefillTests
{
    [Theory]
    [InlineData("3", null, "3", 7.0)]
    [InlineData("1-2", null, "1", 9.0)]
    [InlineData("1+", null, "1", 9.0)]
    [InlineData("5+", null, "5+", null)]
    [InlineData(null, 8.0, "2", 8.0)]
    [InlineData(null, null, "2", 8.0)]
    public void Prefilled_effort_is_the_printed_target_else_the_default(string? rir, double? rpe, string expectedRir, double? expectedRpe)
    {
        var effort = EffortPrefill.For(Harness.Set(8, 12, rpe) with { Rir = rir });
        Assert.Equal(expectedRir, effort!.Value.Rir);
        Assert.Equal(expectedRpe, effort.Value.Rpe);
    }

    [Fact]
    public async Task Start_prefills_effort_only_from_history_and_only_when_rir_is_tracked()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("press", "Press", "Chest", "Barbell", null, 2.5));
        var id = await h.ExerciseId("press");
        var template = await h.Templates.Create(Harness.Template("Press", Harness.Exercise(id, "Press",
            Harness.Set(8, 12))), null, 1, 0, default);

        var first = await h.Workouts.Start(template.Id, null, default);
        var firstSet = first.Exercises.Single().Sets.Single();
        Assert.Null(firstSet.Rir);
        Assert.Null(firstSet.Rpe);
        var exercise = first.Exercises.Single();
        await h.Workouts.Save(first.Id, new SessionInput(null,
            [new SessionExerciseInput(id, "Press", null, exercise.Prescription,
                [new SetInput(50, 12, 8, true, Id: firstSet.Id)], Id: exercise.Id)], first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);

        var next = await h.Workouts.Start(template.Id, null, default);
        var set = next.Exercises.Single().Sets.Single();
        Assert.Equal("2", set.Rir);
        Assert.Equal(8, set.Rpe);
        Assert.False(set.Done);
        await h.Workouts.Discard(next.Id, default);

        var user = h.Db.Users.Single(u => u.Id == h.Db.CurrentUser);
        user.TrackRir = false;
        await h.Db.SaveChangesAsync();
        var untracked = (await h.Workouts.Start(template.Id, null, default)).Exercises.Single().Sets.Single();
        Assert.Null(untracked.Rir);
        Assert.Null(untracked.Rpe);
    }
}
