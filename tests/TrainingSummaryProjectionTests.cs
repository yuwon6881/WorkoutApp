using Workout.Api.Data;
using Workout.Api.Domain;
using Xunit;

namespace Workout.Tests;

public sealed class TrainingSummaryProjectionTests
{
    [Fact]
    public async Task Cross_midnight_completion_keeps_start_date_and_includes_the_completion_window()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        var session = new WorkoutSession { UserId = user.Id, Name = "Late lift",
            StartedAt = new DateTime(2026, 10, 1, 15, 30, 0, DateTimeKind.Utc),
            FinishedAt = new DateTime(2026, 10, 1, 17, 0, 0, DateTimeKind.Utc) };
        h.Db.Workouts.Add(session);
        await h.Db.SaveChangesAsync();
        var row = Assert.Single(await h.Workouts.TrainingSummary(new DateOnly(2026, 10, 2), new DateOnly(2026, 10, 2), "Asia/Kuala_Lumpur", default));
        Assert.Equal(new DateOnly(2026, 10, 1), row.LocalDate);
        Assert.Equal(new DateOnly(2026, 10, 2), row.CompletionDate);
    }

    [Fact]
    public async Task Shared_effort_is_absent_when_tracking_is_disabled()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        user.TrackRir = false;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var session = new WorkoutSession { UserId = user.Id, StartedAt = DateTime.UtcNow.AddHours(-2), FinishedAt = DateTime.UtcNow.AddHours(-1), Name = "Lift" };
        var exercise = new SessionExercise { UserId = user.Id, SessionId = session.Id, NameSnapshot = "Squat" };
        h.Db.Workouts.Add(session);
        h.Db.SessionExercises.Add(exercise);
        h.Db.Sets.Add(new CompletedSet { UserId = user.Id, SessionExerciseId = exercise.Id, Done = true, Reps = 5, WeightKg = 80, Rpe = 9 });
        await h.Db.SaveChangesAsync();
        var summary = Assert.Single(await h.Workouts.TrainingSummary(today.AddDays(-1), today, "UTC", default));
        Assert.Null(summary.AverageRpe);
        h.Db.Sets.Add(new CompletedSet { UserId = user.Id, SessionExerciseId = exercise.Id, Done = true, Reps = 5 });
        await h.Db.SaveChangesAsync();
        summary = Assert.Single(await h.Workouts.TrainingSummary(today.AddDays(-1), today, "UTC", default));
        Assert.Equal(400, summary.ExternalVolumeKg);
        Assert.False(summary.ExternalVolumeComplete);
    }

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
        Assert.True(summary.ExternalVolumeComplete);
        Assert.True(summary.SystemVolumeComplete);
        Assert.Equal(375, summary.SystemVolumeKg);
        Assert.Equal(3, summary.WorkingSetCount);
        Assert.Equal(8.5, summary.AverageRpe);
        Assert.Equal(new DateOnly(2026, 10, 1), summary.LocalDate);
        Assert.Empty(await h.Workouts.TrainingSummary(new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 1), "UTC", default));
    }
}
