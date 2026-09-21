using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class MuscleBalanceTests
{
    [Fact]
    public async Task Balance_credits_working_sets_and_excludes_warmups_unfinished_and_outside_sessions()
    {
        await using var h = await Ready();
        var userId = h.Db.CurrentUser!.Value;
        var bench = await h.ExerciseId("bench");
        var squat = await h.ExerciseId("squat");
        var now = DateTime.UtcNow;
        var finished = AddSession(h, userId, "Inside window", now);
        AddExercise(h, finished, bench, "Bench Press", (true, false), (true, false), (true, true), (false, false));
        AddExercise(h, finished, squat, "Back Squat", (true, false));

        var outside = AddSession(h, userId, "Outside window", now.AddDays(-8));
        AddExercise(h, outside, bench, "Bench Press", (true, false));
        var unfinished = AddSession(h, userId, "Still active", null);
        AddExercise(h, unfinished, bench, "Bench Press", (true, false));
        await h.Db.SaveChangesAsync();

        var result = await h.MuscleBalance.Balance("1w", "UTC", default);
        var chest = Assert.Single(result.Muscles, muscle => muscle.Muscle == "Chest");
        var triceps = Assert.Single(result.Muscles, muscle => muscle.Muscle == "Triceps");
        var quads = Assert.Single(result.Muscles, muscle => muscle.Muscle == "Quads");
        var glutes = Assert.Single(result.Muscles, muscle => muscle.Muscle == "Glutes");

        Assert.Equal(1, result.Sessions);
        Assert.Equal(3, result.TotalSets);
        Assert.Equal(2, chest.Sets);
        Assert.Equal(2, chest.PrimarySets);
        Assert.Equal(1, triceps.Sets);
        Assert.Equal(1, triceps.SecondarySets);
        Assert.Equal(1, quads.Sets);
        Assert.Equal(0.5, glutes.Sets);
        Assert.Equal(DateOnly.FromDateTime(now), chest.LastTrainedDate);
    }

    [Fact]
    public async Task Balance_reports_unmatched_work_as_unattributed_and_supports_custom_profiles()
    {
        await using var h = await Ready();
        var userId = h.Db.CurrentUser!.Value;
        var custom = new CustomExercise
        {
            UserId = userId,
            Name = "Custom Fly",
            Muscle = "Chest",
            SecondaryMusclesJson = "[\"Shoulders\"]"
        };
        h.Db.CustomExercises.Add(custom);
        var session = AddSession(h, userId, "Custom and unknown", DateTime.UtcNow);
        AddExercise(h, session, custom.Id, custom.Name, (true, false));
        AddExercise(h, session, null, "Mystery movement", (true, false));
        await h.Db.SaveChangesAsync();

        var result = await h.MuscleBalance.Balance(null, "UTC", default);
        var chest = Assert.Single(result.Muscles, muscle => muscle.Muscle == "Chest");
        var shoulders = Assert.Single(result.Muscles, muscle => muscle.Muscle == "Shoulders");

        Assert.Equal("1w", result.Range);
        Assert.Equal(2, result.TotalSets);
        Assert.Equal(1, result.UnattributedSets);
        Assert.Equal(new[] { "Mystery movement" }, result.UnattributedExamples);
        Assert.Equal(1, chest.PrimarySets);
        Assert.Equal(0.5, shoulders.SecondarySets);
    }

    [Fact]
    public async Task Balance_rejects_unknown_ranges_and_time_zones()
    {
        await using var h = await Ready();

        var rangeError = await Assert.ThrowsAsync<DomainException>(() => h.MuscleBalance.Balance("2w", "UTC", default));
        var zoneError = await Assert.ThrowsAsync<DomainException>(() => h.MuscleBalance.Balance("1w", "not-a-time-zone", default));
        Assert.Equal(400, rangeError.Status);
        Assert.Equal(400, zoneError.Status);
    }

    [Fact]
    public async Task Balance_is_account_scoped()
    {
        await using var h = await Ready();
        var aliceId = h.Db.CurrentUser!.Value;
        var bob = await h.CreateUser("bob");
        h.Db.CurrentUser = bob.Id;
        var bench = await h.ExerciseId("bench");
        var bobsSession = AddSession(h, bob.Id, "Bob only", DateTime.UtcNow);
        AddExercise(h, bobsSession, bench, "Bench Press", (true, false));
        await h.Db.SaveChangesAsync();
        h.Db.CurrentUser = aliceId;

        var result = await h.MuscleBalance.Balance("1w", "UTC", default);

        Assert.Equal(0, result.Sessions);
        Assert.Equal(0, result.TotalSets);
        Assert.All(result.Muscles, muscle => Assert.Equal(0, muscle.Sets));
    }

    private static async Task<Harness> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("bench", "Bench Press", "Chest", "Barbell", "", null),
            new SeedExercise("squat", "Back Squat", "Quads", "Barbell", "", null));
        return h;
    }

    private static WorkoutSession AddSession(Harness h, Guid userId, string name, DateTime? finishedAt)
    {
        var session = new WorkoutSession
        {
            UserId = userId,
            Name = name,
            Active = finishedAt is null,
            StartedAt = finishedAt ?? DateTime.UtcNow,
            FinishedAt = finishedAt
        };
        h.Db.Workouts.Add(session);
        return session;
    }

    private static void AddExercise(Harness h, WorkoutSession session, Guid? exerciseId, string name,
        params (bool Done, bool Warmup)[] sets)
    {
        var exercise = new SessionExercise
        {
            UserId = session.UserId,
            SessionId = session.Id,
            ExerciseId = exerciseId,
            NameSnapshot = name
        };
        h.Db.SessionExercises.Add(exercise);
        foreach (var (done, warmup) in sets)
            h.Db.Sets.Add(new CompletedSet
            {
                UserId = session.UserId,
                SessionExerciseId = exercise.Id,
                Done = done,
                Warmup = warmup,
                Reps = done ? 8 : null
            });
    }
}
