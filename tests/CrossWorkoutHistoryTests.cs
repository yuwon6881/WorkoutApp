using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A lift logged in one workout informs the same lift in another workout started afterwards, both
/// in the target fixed at start and in the live "last time" read.
public sealed class CrossWorkoutHistoryTests
{
    [Fact]
    public async Task A_squat_finished_in_one_workout_targets_and_reports_in_the_next()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("squat", "Barbell back squat", "Quads", "Barbell", null));
        var squat = await h.ExerciseId("squat");
        var lower = await h.Templates.Create(Harness.Template("Lower Body Strength",
            Harness.Exercise(squat, "Barbell back squat", Harness.Set(8, 10))), null, 1, 0, default);
        var upper = await h.Templates.Create(Harness.Template("Upper Body A",
            Harness.Exercise(squat, "Barbell back squat", Harness.Set(8, 10))), null, 1, 1, default);

        var first = await h.Workouts.Start(lower.Id, null, default);
        var logged = Assert.Single(first.Exercises);
        await h.Workouts.Save(first.Id, new SessionInput(null,
            [new SessionExerciseInput(logged.ExerciseId, logged.Name, null, logged.Prescription,
                [new SetInput(100, 8, 8, true)])], first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);

        var next = await h.Workouts.Start(upper.Id, null, default);
        var suggestion = Assert.Single(next.Exercises).Sets.Single().Suggestion;
        Assert.NotNull(suggestion);
        Assert.DoesNotContain("First time through", suggestion!.Reason);
        Assert.Equal(first.Id, suggestion.SourceSessionId);
        Assert.NotNull(suggestion.SuggestedLoadKg);

        var recent = await new ExerciseService(h.Db).RecentSets(squat, 3, default);
        Assert.Equal(first.Id, Assert.Single(recent).Id);
    }
}
