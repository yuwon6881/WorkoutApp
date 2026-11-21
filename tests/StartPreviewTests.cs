using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class StartPreviewTests
{
    [Fact]
    public async Task StartPreview_returns_planned_loads_matching_Start()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("deadlift", "Deadlift", "Hamstrings", "Barbell", null, 2.5));
        var id = await h.ExerciseId("deadlift");

        // 4 warmups, 3 working sets of 4 reps at 80%
        var warmup = Harness.Set(4, 4) with { Warmup = true };
        var working = Harness.Set(4, 4) with { LoadText = "80%", Rir = "2" };
        var template = await h.Templates.Create(Harness.Template("Day 1 - Lower #1",
            Harness.Exercise(id, "Deadlift", warmup, warmup, warmup, warmup, working, working, working)), null, 1, 0, default);

        // First test: with NO history
        var previewBeforeHistory = await h.Workouts.StartPreview(template.Id, default);
        Assert.Single(previewBeforeHistory);
        var exPreviewNoHistory = previewBeforeHistory.Single();
        Assert.Equal(7, exPreviewNoHistory.Sets.Count);

        // Log a previous session with heavy deadlift: 175 kg x 1 (or 140 kg x 5) to give 1RM ~175 kg (so 80% is 140 kg)
        // 175 x 1 at 10 RPE => 1RM = 175 kg. 80% of 175 = 140 kg.
        var session = await h.Workouts.Start(template.Id, null, default);
        var ex = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(id, "Deadlift", null, ex.Prescription,
                [new SetInput(175, 1, 10, true, Id: ex.Sets.First(s => !s.Warmup).Id)], Id: ex.Id)], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        // Now test StartPreview with history
        var preview = await h.Workouts.StartPreview(template.Id, default);
        Assert.Single(preview);
        var exPreview = preview.Single();
        Assert.Equal(7, exPreview.Sets.Count);

        // Check warmup sets: positions 0, 1, 2, 3
        for (var i = 0; i < 4; i++)
        {
            Assert.True(exPreview.Sets[i].Warmup);
            Assert.Equal(i, exPreview.Sets[i].Position);
        }

        // Check working sets: positions 4, 5, 6
        for (var i = 4; i < 7; i++)
        {
            Assert.False(exPreview.Sets[i].Warmup);
            Assert.Equal(i, exPreview.Sets[i].Position);
            Assert.Equal(140, exPreview.Sets[i].WeightKg);
        }
    }

    [Fact]
    public async Task StartPreview_with_catalog_exercise_and_rir_history()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("deadlift", "Deadlift", "Hamstrings", "Barbell", null, 2.5));
        var id = await h.ExerciseId("deadlift");

        // Log a previous session with 140 kg x 3 with 2 RIR (like in Image 2)
        var template1 = await h.Templates.Create(Harness.Template("Prev",
            Harness.Exercise(id, "Deadlift", Harness.Set(4, 4))), null, 1, 0, default);
        var session = await h.Workouts.Start(template1.Id, null, default);
        var ex = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(id, "Deadlift", null, ex.Prescription,
                [new SetInput(140, 3, 8, true, Rir: "2", Id: ex.Sets[0].Id)], Id: ex.Id)], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        // Now test StartPreview for a template with Deadlift (catalog ID) with 80% working sets
        var warmup = Harness.Set(4, 4) with { Warmup = true };
        var working = Harness.Set(4, 4) with { LoadText = "80%", Rir = "2" };
        var template2 = await h.Templates.Create(Harness.Template("Day 1 - Lower #1",
            Harness.Exercise(id, "Deadlift", warmup, warmup, warmup, warmup, working, working, working)), null, 1, 0, default);

        var preview = await h.Workouts.StartPreview(template2.Id, default);
        Assert.Single(preview);
        var exPreview = preview.Single();
        Assert.Equal(7, exPreview.Sets.Count);

        for (var i = 4; i < 7; i++)
        {
            Assert.False(exPreview.Sets[i].Warmup);
            Assert.Equal(130, exPreview.Sets[i].WeightKg);
        }
    }
}
