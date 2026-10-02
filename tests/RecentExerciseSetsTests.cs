using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class RecentExerciseSetsTests
{
    [Fact]
    public async Task Only_three_completed_qualifying_sessions_and_the_requested_exercise_are_returned()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", "", null));
        var id = await h.ExerciseId("bench");
        var time = DateTime.UtcNow.AddDays(-8);
        for (var i = 0; i < 8; i++)
        {
            var session = new WorkoutSession { UserId = user.Id, Name = $"Session {i}", StartedAt = time.AddDays(i),
                Active = i == 7, FinishedAt = i == 7 ? null : time.AddDays(i).AddHours(1) };
            var exercise = new SessionExercise { UserId = user.Id, SessionId = session.Id, ExerciseId = id };
            h.Db.Workouts.Add(session);
            h.Db.SessionExercises.Add(exercise);
            h.Db.Sets.Add(new CompletedSet { UserId = user.Id, SessionExerciseId = exercise.Id, Position = 0, Done = true, Warmup = true, WeightKg = null, Reps = 5 });
            h.Db.Sets.Add(new CompletedSet { UserId = user.Id, SessionExerciseId = exercise.Id, Position = 1, Done = i != 6, DurationSeconds = 45, Rir = "3" });
        }
        await h.Db.SaveChangesAsync();
        var rows = await new ExerciseService(h.Db).RecentSets(id, 3, default);
        Assert.Equal(new[] { "Session 5", "Session 4", "Session 3" }, rows.Select(row => row.Name));
        Assert.All(rows, row => {
            Assert.Single(row.Exercises);
            Assert.Equal(id, row.Exercises[0].ExerciseId);
            Assert.Equal(2, row.Exercises[0].Sets.Count);
            Assert.Null(row.Exercises[0].Sets[0].WeightKg);
            Assert.Equal(45, row.Exercises[0].Sets[1].DurationSeconds);
            Assert.Equal("3", row.Exercises[0].Sets[1].Rir);
        });
    }
}
