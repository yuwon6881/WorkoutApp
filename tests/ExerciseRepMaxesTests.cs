using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ExerciseRepMaxesTests
{
    private static (CompletedSet Set, double Load, DateOnly Date) Lift(double load, int reps, string? rir = null, double? rpe = null, int day = 1)
        => (new CompletedSet { Id = Guid.NewGuid(), Reps = reps, Rir = rir, Rpe = rpe }, load, new DateOnly(2026, 10, day));

    [Fact]
    public void Lists_each_standard_rep_max_once_with_the_set_behind_it()
    {
        var records = ExerciseRepMaxes.From([Lift(140, 1, "0"), Lift(120, 3, "1"), Lift(110, 5, "1"), Lift(100, 8, "1"), Lift(90, 10, "0")]);

        Assert.Equal([1, 3, 5, 8, 10], records.Select(x => x.Reps));
        Assert.Equal([140, 120, 110, 100, 90], records.Select(x => x.LoadKg));
    }

    [Fact]
    public void A_set_that_holds_several_rep_maxes_is_listed_only_for_the_largest()
    {
        // 100 x 8 is also the best 5, 3 and 1 rep set here, so only the 8 is news.
        var records = ExerciseRepMaxes.From([Lift(100, 8, "1"), Lift(80, 10, "1")]);

        Assert.Equal([8, 10], records.Select(x => x.Reps));
    }

    [Fact]
    public void A_heavier_set_for_fewer_reps_is_its_own_record_and_keeps_its_own_reps_and_effort()
    {
        var records = ExerciseRepMaxes.From([Lift(100, 6, "1"), Lift(105, 3, "0")]);

        var five = Assert.Single(records, x => x.Reps == 5);
        Assert.Equal((100, 6, "1"), (five.LoadKg, five.ActualReps, five.Rir));
        var three = Assert.Single(records, x => x.Reps == 3);
        Assert.Equal((105, 3, "0"), (three.LoadKg, three.ActualReps, three.Rir));
    }

    [Fact]
    public void Sets_far_from_failure_are_not_maxes_but_sets_with_no_recorded_effort_are()
    {
        Assert.Empty(ExerciseRepMaxes.From([Lift(100, 5, "3"), Lift(100, 5, "5+")]));
        Assert.Equal(5, Assert.Single(ExerciseRepMaxes.From([Lift(100, 5)])).Reps);
        Assert.Equal(5, Assert.Single(ExerciseRepMaxes.From([Lift(100, 5, "2")])).Reps);
    }

    [Fact]
    public void Reps_past_ten_and_unknown_loads_never_make_a_record()
    {
        Assert.Equal([10], ExerciseRepMaxes.From([Lift(60, 15, "1")]).Select(x => x.Reps));
        Assert.Empty(ExerciseRepMaxes.From([Lift(0, 10, "1")]));
    }

    [Fact]
    public void Reads_the_reserve_from_rpe_when_no_rir_was_typed()
    {
        Assert.Equal("1", ExerciseRepMaxes.ReserveText(null, 9));
        Assert.Equal("5+", ExerciseRepMaxes.ReserveText("5+", null));
        Assert.Null(ExerciseRepMaxes.ReserveText(null, null));
    }

    [Fact]
    public async Task The_insight_carries_each_sessions_effort_and_the_rep_maxes()
    {
        var h = await Harness.Create();
        await using var owned = h;
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null));
        var benchId = await h.ExerciseId("bench");
        var template = await h.Templates.Create(
            Harness.Template("Push", Harness.Exercise(benchId, "Bench press", Harness.Set(5, 8))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(5, 8)],
                [new SetInput(100, 5, 9, true, Rir: "1")])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var insight = await new ExerciseService(h.Db).Insight(benchId, "all", 0, 20, default);

        Assert.Equal("1", Assert.Single(insight.Points).Rir);
        var record = Assert.Single(insight.RepMaxes!);
        Assert.Equal((5, 100, 5, "1"), (record.Reps, record.LoadKg, record.ActualReps, record.Rir));
    }
}
