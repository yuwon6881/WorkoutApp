using Workout.Api.Data;
using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

public sealed class TrainingSummaryProjectionTests
{
    [Fact]
    public async Task Summaries_match_session_accounting_and_use_the_requested_local_date()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        var start = new DateTime(2026, 9, 30, 17, 0, 0, DateTimeKind.Utc);
        var session = new WorkoutSession { UserId = user.Id, StartedAt = start, FinishedAt = start.AddHours(1), Active = false, Name = "Fixture" };
        var external = new SessionExercise { UserId = user.Id, SessionId = session.Id, NameSnapshot = "Lift", LoadModel = LoadModels.External };
        var body = new SessionExercise { UserId = user.Id, SessionId = session.Id, NameSnapshot = "Pull-up", LoadModel = LoadModels.FullBodyweight };
        h.Db.Workouts.Add(session);
        h.Db.SessionExercises.AddRange(external, body);
        h.Db.Sets.AddRange(
            new CompletedSet { UserId = user.Id, SessionExerciseId = external.Id, Done = true, Reps = 8, WeightKg = 50, Rpe = 8 },
            new CompletedSet { UserId = user.Id, SessionExerciseId = external.Id, Done = true, Warmup = true, Reps = 10, WeightKg = 20 },
            new CompletedSet { UserId = user.Id, SessionExerciseId = external.Id, Done = true, DurationSeconds = 40, WeightKg = 10 },
            new CompletedSet { UserId = user.Id, SessionExerciseId = body.Id, Done = true, Reps = 5, SystemLoadKg = 75, Rpe = 9 });
        await h.Db.SaveChangesAsync();
        var view = await h.Workouts.Get(session.Id, default);
        var summary = Assert.Single(await h.Workouts.TrainingSummary(new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 1), "Asia/Kuala_Lumpur", default));
        Assert.Equal(view.VolumeKg, summary.ExternalVolumeKg);
        Assert.Equal(view.SystemVolumeKg, summary.SystemVolumeKg);
        Assert.Equal(400, summary.ExternalVolumeKg);
        Assert.Equal(375, summary.SystemVolumeKg);
        Assert.Equal(3, summary.WorkingSetCount);
        Assert.Equal(8.5, summary.AverageRpe);
        Assert.Equal(new DateOnly(2026, 10, 1), summary.LocalDate);
        Assert.Empty(await h.Workouts.TrainingSummary(new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 1), "UTC", default));
    }
}
