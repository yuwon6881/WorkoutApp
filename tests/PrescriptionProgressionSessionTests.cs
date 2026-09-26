using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class PrescriptionProgressionSessionTests
{
    private static async Task<Guid> Template(Harness h, SetPrescription prescription)
    {
        await h.Seed(new SeedExercise("curl", "Curl", "Biceps", "Dumbbell", "Curl", null, 2.5));
        var id = await h.ExerciseId("curl");
        var template = await h.Templates.Create(Harness.Template("Arms",
            Harness.Exercise(id, "Curl", prescription)), null, 1, 0, default);
        return template.Id;
    }

    private static async Task Log(Harness h, SessionView session, double load, int reps, double? rpe, string? rir = null)
    {
        var exercise = Assert.Single(session.Exercises);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(load, reps, rpe, true, Id: exercise.Sets[0].Id, Rir: rir)], Id: exercise.Id)],
            session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
    }

    [Fact]
    public async Task Large_step_transition_survives_finish_and_rebuilds_next_session()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Template(h, Harness.Set(10, 15));
        var first = await h.Workouts.Start(template, null, default);
        await Log(h, first, 12.5, 15, 8);
        var next = await h.Workouts.Start(template, null, default);
        var set = Assert.Single(next.Exercises.Single().Sets);
        Assert.Equal(15, set.WeightKg);
        Assert.Equal(7, set.Reps);
        Assert.Equal(first.Id, set.Suggestion!.SourceSessionId);
        Assert.True(set.Suggestion.IsRepRangeTransition);
        Assert.False(set.Done);
        Assert.Null(set.Rpe);
        Assert.Equal(10, next.Exercises.Single().Prescription[0].RepMin);
        await Log(h, next, 15, 7, 8);
        var third = await h.Workouts.Start(template, null, default);
        var rebuilding = Assert.Single(third.Exercises.Single().Sets);
        Assert.Equal(15, rebuilding.WeightKg);
        Assert.Equal(8, rebuilding.Reps);
        Assert.True(rebuilding.Suggestion!.IsRepRangeTransition);
    }

    [Fact]
    public async Task No_rep_target_stays_empty_and_does_not_automatically_increase_load()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Template(h, new SetPrescription(null, null, 8, null, null, null, null));
        await Log(h, await h.Workouts.Start(template, null, default), 50, 8, 8);
        var next = await h.Workouts.Start(template, null, default);
        var set = Assert.Single(next.Exercises.Single().Sets);
        Assert.Equal(50, set.WeightKg);
        Assert.Null(set.Reps);
        Assert.False(set.Done);
    }

    [Fact]
    public async Task Five_plus_RIR_reaches_the_policy_and_history_keeps_more_than_four_sessions()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Template(h, Harness.Set(10, 15));
        for (var index = 0; index < 5; index++)
            await Log(h, await h.Workouts.Start(template, null, default), 50, 15, null, "5+");
        var next = await h.Workouts.Start(template, null, default);
        var exercise = next.Exercises.Single();
        Assert.Equal(52.5, exercise.Sets[0].WeightKg);
        var history = await h.Workouts.PreviousExposures(exercise.ExerciseId, exercise.Name, default);
        Assert.Equal(5, history[1].Count);
        Assert.All(history[1], exposure => Assert.Equal("5+", exposure.Rir));
        Assert.All(history[1], exposure => Assert.True(exposure.HasPrescription));
        Assert.All(history[1], exposure => Assert.Equal(10, exposure.RepMin));
        var sessionIds = await h.Db.Workouts.Select(session => session.Id).ToListAsync();
        Assert.All(history[1], exposure => Assert.Contains(exposure.SessionId, sessionIds));
    }
}
