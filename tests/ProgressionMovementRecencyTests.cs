using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ProgressionMovementRecencyTests
{
    [Theory]
    [InlineData(LoadModels.External, "Curl", 50, 52.5)]
    [InlineData(LoadModels.FullBodyweight, "Weighted Pull-Up", 10, 12.5)]
    public async Task Returning_a_later_set_is_not_a_layoff_when_the_movement_was_trained_recently(
        string model, string name, double enteredLoad, double expectedLoad)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        if (model == LoadModels.FullBodyweight)
        {
            h.Db.IntegrationGrants.Add(new IntegrationGrant { UserId = h.Db.CurrentUser!.Value,
                Peer = "nutrition", Status = "active", CentralConnectionId = Guid.NewGuid(), CentralConnectionGeneration = 1 });
            var context = new NutritionTrainingContext(null, 1, "UTC", "maintain", false, null, null, null,
                80, DateOnly.FromDateTime(DateTime.UtcNow), null, null, DateTime.UtcNow, true);
            h.Db.NutritionContexts.Add(new NutritionContextCache { UserId = h.Db.CurrentUser!.Value,
                ContextJson = Json.Write(context), LastSuccessAt = DateTime.UtcNow });
            await h.Db.SaveChangesAsync();
        }
        await h.Seed(new SeedExercise("movement", name, "Back", "Dumbbell", null, 2.5, model));
        var exerciseId = await h.ExerciseId("movement");
        var twoSets = await h.Templates.Create(Harness.Template("Two sets", Harness.Exercise(exerciseId, name,
            Harness.Set(8, 12, 8), Harness.Set(8, 12, 8))), null, 1, 0, default);
        var oneSet = await h.Templates.Create(Harness.Template("One set", Harness.Exercise(exerciseId, name,
            Harness.Set(8, 12, 8))), null, 1, 0, default);
        var old = await Complete(h, twoSets.Id, enteredLoad);
        var row = await h.Db.Workouts.SingleAsync(w => w.Id == old);
        row.StartedAt = DateTime.UtcNow.AddDays(-36);
        row.FinishedAt = DateTime.UtcNow.AddDays(-35);
        await h.Db.SaveChangesAsync();
        await Complete(h, oneSet.Id, enteredLoad);

        var next = await h.Workouts.Start(twoSets.Id, null, default);
        var second = next.Exercises.Single().Sets[1];
        Assert.Equal(expectedLoad, second.WeightKg);
        Assert.DoesNotContain("days away", second.Suggestion!.Reason);
        Assert.Equal(old, second.Suggestion.SourceSessionId);
        Assert.False(second.Done);
        Assert.Equal(8, second.Rpe);
    }

    private static async Task<Guid> Complete(Harness h, Guid templateId, double load)
    {
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = session.Exercises.Single();
        var sets = exercise.Sets.Select(set => new SetInput(load, 12, 8, true, Id: set.Id)).ToList();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription, sets, Id: exercise.Id)],
            session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
        return session.Id;
    }
}
