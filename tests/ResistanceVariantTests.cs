using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ResistanceVariantTests
{
    [Theory]
    [InlineData("Weighted Pull-Up", ResistanceModes.Added)]
    [InlineData("Weighted Dip", ResistanceModes.Added)]
    [InlineData("Assisted Chin-Up", ResistanceModes.Assistance)]
    [InlineData("Pull-Up", ResistanceModes.Bodyweight)]
    [InlineData("Neutral-Grip Pullup", ResistanceModes.Bodyweight)]
    [InlineData("Dead Hang", ResistanceModes.Bodyweight)]
    public void A_bodyweight_movement_takes_its_mode_from_its_name(string name, string mode)
        => Assert.Equal(mode, ResistanceVariant.For(LoadModels.FullBodyweight, name));

    [Fact]
    public void Other_load_models_keep_their_own_mode()
    {
        Assert.Equal(ResistanceModes.External, ResistanceVariant.For(LoadModels.External, "Assisted Pull-Up"));
        Assert.Equal(ResistanceModes.RepsOnly, ResistanceVariant.For(LoadModels.RepsOnly, "Weighted Crunch"));
    }

    [Theory]
    [InlineData("Weighted Pull-Up", ResistanceModes.Bodyweight, ResistanceModes.Added, 90)]
    [InlineData("Pull-Up", ResistanceModes.Added, ResistanceModes.Bodyweight, 80)]
    [InlineData("Assisted Pull-Up", ResistanceModes.Added, ResistanceModes.Assistance, 70)]
    public async Task A_set_cannot_choose_a_mode_its_exercise_name_contradicts(string name, string requested, string expected, double systemLoad)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("pull", name, "Back", "Bodyweight", "", null, 2.5, LoadModels.FullBodyweight));
        var id = await h.ExerciseId("pull");
        var template = await h.Templates.Create(Harness.Template("Pull", Harness.Exercise(id, name, Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        Assert.Equal(expected, session.Exercises.Single().Sets[0].ResistanceMode);

        var row = await h.Db.Workouts.SingleAsync(x => x.Id == session.Id);
        row.BodyWeightSnapshotJson = Json.Write(new BodyWeightSnapshot(80, null, null, null, 80, "scale", null, "test", null, DateTime.UtcNow));
        await h.Db.SaveChangesAsync();
        var exercise = session.Exercises.Single();
        var saved = await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(id, exercise.Name, null, exercise.Prescription,
                [new SetInput(10, 8, 8, true, ResistanceMode: requested, Id: exercise.Sets[0].Id)], Id: exercise.Id)],
            session.Revision, null), default);
        var set = saved.Exercises.Single().Sets[0];
        Assert.Equal(expected, set.ResistanceMode);
        Assert.Equal(systemLoad, set.SystemLoadKg);
    }
}
