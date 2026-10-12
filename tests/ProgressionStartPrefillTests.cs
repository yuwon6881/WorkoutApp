using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ProgressionStartPrefillTests
{
    [Theory]
    [InlineData("maintain", null, null, null, false, true, 0, "normal", 52.5)]
    [InlineData("gain", null, null, null, false, true, 0, "normal", 52.5)]
    [InlineData("lose", .5, null, null, false, true, 0, "conservative", 50)]
    [InlineData("lose", .75, null, null, false, true, 0, "preservation", 50)]
    [InlineData("lose", .5, .8, 14, false, true, 0, "preservation", 50)]
    [InlineData("gain", null, .6, 14, false, true, 0, "conservative", 50)]
    [InlineData("lose", .8, null, null, true, true, 0, "normal", 52.5)]
    [InlineData("lose", .8, null, null, false, false, 0, "normal", 52.5)]
    [InlineData("lose", .8, null, null, false, true, 8, "normal", 52.5)]
    public async Task Workout_start_prefills_the_server_suggestion_using_the_qualified_Nutrition_goal(
        string goal, double? target, double? observed, int? window, bool phaseComplete, bool confirmed,
        int daysOld, string expectedMode, double expectedLoad)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("press", "Press", "Chest", "Barbell", null, 2.5));
        var id = await h.ExerciseId("press");
        var template = await h.Templates.Create(Harness.Template("Press", Harness.Exercise(id, "Press",
            Harness.Set(8, 12, 8))), null, 1, 0, default);
        var first = await h.Workouts.Start(template.Id, null, default);
        var exercise = first.Exercises.Single();
        await h.Workouts.Save(first.Id, new SessionInput(null,
            [new SessionExerciseInput(id, "Press", null, exercise.Prescription,
                [new SetInput(50, 12, 8, true, Id: exercise.Sets.Single().Id)], Id: exercise.Id)], first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);
        var retrieved = DateTime.UtcNow.AddDays(-daysOld);
        var context = new NutritionTrainingContext(null, 1, "UTC", goal, phaseComplete, target, observed, window,
            null, null, null, null, retrieved, confirmed);
        h.Db.IntegrationGrants.Add(new IntegrationGrant { UserId = h.Db.CurrentUser!.Value, Peer = "nutrition",
            Status = "active", CentralConnectionId = Guid.NewGuid(), CentralConnectionGeneration = 1 });
        h.Db.NutritionContexts.Add(new NutritionContextCache { UserId = h.Db.CurrentUser!.Value,
            ContextJson = Json.Write(context), LastSuccessAt = retrieved });
        await h.Db.SaveChangesAsync();

        var next = await h.Workouts.Start(template.Id, null, default);
        var set = next.Exercises.Single().Sets.Single();
        Assert.Equal(expectedMode, set.Suggestion!.ProgressionMode);
        Assert.Equal(expectedLoad, set.WeightKg);
        Assert.Equal(set.Suggestion.SuggestedLoadKg, set.WeightKg);
        Assert.Equal(set.Suggestion.SuggestedReps, set.Reps);
        Assert.Equal(8, next.Exercises.Single().Prescription.Single().TargetRpe);
        Assert.False(set.Done);
        Assert.Null(set.Rpe);
        Assert.Null(set.Rir);
    }
}
