using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System.Text.Json;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class WorkoutLogicIntegrityTests
{
    [Fact]
    public async Task Deleting_the_only_exposure_removes_its_strength_trend()
    {
        await using var h = await Ready();
        var finished = await Finish(h);
        Assert.NotEmpty(await h.Db.Progress.ToListAsync());
        await h.Workouts.DeleteFromHistory(finished.Id, default);
        Assert.Empty(await h.Db.Progress.ToListAsync());
    }

    [Fact]
    public async Task Heaviest_load_keeps_the_reps_from_that_same_set()
    {
        await using var h = await Ready();
        await Finish(h);
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var insight = await new ExerciseService(h.Db, cache).Insight(await h.ExerciseId("bench"), "all", 0, 20, default);
        Assert.Equal(100, insight.HeaviestKg);
        Assert.Equal(3, insight.HeaviestReps);
    }

    [Fact]
    public async Task Deleting_a_later_exposure_rebuilds_the_trend_from_the_surviving_workout()
    {
        await using var h = await Ready();
        var first = await Finish(h);
        var baseline = await h.Db.Progress.AsNoTracking().SingleAsync();
        var later = await Finish(h);
        await h.Workouts.DeleteFromHistory(later.Id, default);
        var rebuilt = await h.Db.Progress.AsNoTracking().SingleAsync();
        Assert.Equal(baseline.TrendE1rmKg, rebuilt.TrendE1rmKg);
        Assert.Equal(baseline.LastE1rmKg, rebuilt.LastE1rmKg);
        Assert.False((await h.Workouts.Get(first.Id, default)).Active);
    }

    [Fact]
    public async Task Timed_sets_accept_external_load_but_refuse_rep_and_effort_values()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("carry", "Carry", "Back", "Dumbbell", "", null, TrackingMode: TrackingModes.Duration));
        var id = await h.ExerciseId("carry");
        var template = await h.Templates.Create(Harness.Template("Carry", Harness.Exercise(id, "Carry", Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var exercise = session.Exercises[0];
        var invalid = new SessionInput(null, [new SessionExerciseInput(id, exercise.Name, null, exercise.Prescription,
            [new SetInput(20, 8, 8, true, Id: exercise.Sets[0].Id, DurationSeconds: 30)], Id: exercise.Id)], session.Revision, null);
        await Assert.ThrowsAsync<DomainException>(() => h.Workouts.Save(session.Id, invalid, default));
        var valid = invalid with { Exercises = [invalid.Exercises[0] with { Sets = [new SetInput(20, null, null, true, Id: exercise.Sets[0].Id, DurationSeconds: 30)] }] };
        var saved = await h.Workouts.Save(session.Id, valid, default);
        var finished = await h.Workouts.Finish(session.Id, saved.Revision, default);
        Assert.Equal(20, finished.Exercises[0].Sets[0].WeightKg);
        Assert.Null(finished.VolumeKg);
        Assert.Equal(0, finished.PrCount);
        var insight = await new ExerciseService(h.Db).Insight(id, "all", 0, 20, default);
        Assert.False(insight.PartialVolume);
        Assert.Null(insight.HeaviestKg);
        Assert.Null(insight.LargestSessionVolumeKg);
    }

    [Fact]
    public async Task Rep_exercises_cannot_be_logged_with_time_instead_of_reps()
    {
        await using var h = await Ready();
        var session = await h.Workouts.Start((await h.Templates.List(null, true, default))[0].Id, null, default);
        using var patch = JsonDocument.Parse($$"""{"revision":{{session.Revision}},"reps":null,"durationSeconds":30,"done":true}""");
        await Assert.ThrowsAsync<DomainException>(() => h.Workouts.PatchSet(session.Id, session.Exercises[0].Sets[0].Id, patch.RootElement, default));
    }

    private static async Task<Harness> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", "", null));
        await h.Templates.Create(Harness.Template("Push", Harness.Exercise(await h.ExerciseId("bench"), "Bench",
            Harness.Set(3, 3), Harness.Set(12, 12))), null, 1, 0, default);
        return h;
    }

    private static async Task<SessionView> Finish(Harness h)
    {
        var session = await h.Workouts.Start((await h.Templates.List(null, true, default))[0].Id, null, default);
        var exercise = session.Exercises[0];
        var saved = await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(100, 3, 8, true, Id: exercise.Sets[0].Id), new SetInput(60, 12, 8, true, Id: exercise.Sets[1].Id)], Id: exercise.Id)],
            session.Revision, null), default);
        return await h.Workouts.Finish(session.Id, saved.Revision, default);
    }
}
