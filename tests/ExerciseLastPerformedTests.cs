using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ExerciseLastPerformedTests
{
    [Fact]
    public async Task Each_exercise_reports_the_top_working_set_of_its_latest_finished_workout()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null),
            new SeedExercise("squat", "Squat", "Quads", "Barbell", null));
        var bench = await h.ExerciseId("bench");
        var squat = await h.ExerciseId("squat");
        var start = DateTime.UtcNow.AddDays(-3);

        void Log(string name, DateTime started, bool finished, Guid exerciseId, params (double? Kg, int? Reps, bool Done, bool Warmup)[] sets)
        {
            var session = new WorkoutSession { UserId = user.Id, Name = name, StartedAt = started, Active = !finished,
                FinishedAt = finished ? started.AddHours(1) : null };
            var exercise = new SessionExercise { UserId = user.Id, SessionId = session.Id, ExerciseId = exerciseId };
            h.Db.Workouts.Add(session);
            h.Db.SessionExercises.Add(exercise);
            for (var i = 0; i < sets.Length; i++)
                h.Db.Sets.Add(new CompletedSet { UserId = user.Id, SessionExerciseId = exercise.Id, Position = i,
                    WeightKg = sets[i].Kg, Reps = sets[i].Reps, Done = sets[i].Done, Warmup = sets[i].Warmup });
        }

        Log("Older bench", start, true, bench, (120, 3, true, false));
        // The latest finished bench session wins even with a lighter top set; its warm-up and its
        // unfinished set never count.
        Log("Latest bench", start.AddDays(1), true, bench, (140, 1, true, true), (100, 8, true, false), (100, 9, true, false), (110, 5, false, false));
        // An open workout is not history yet.
        Log("Open bench", start.AddDays(2), false, bench, (150, 5, true, false));
        // Only warm-ups logged: nothing to report for squat.
        Log("Squat warm-ups", start.AddDays(1), true, squat, (60, 5, true, true));
        await h.Db.SaveChangesAsync();

        var rows = await new ExerciseService(h.Db).LastPerformed(default);

        var row = Assert.Single(rows);
        Assert.Equal(bench, row.ExerciseId);
        Assert.Equal(100, row.WeightKg);
        Assert.Equal(9, row.Reps);
        Assert.Equal(start.AddDays(1).AddHours(1), row.FinishedAt, TimeSpan.FromSeconds(1));
    }
}
