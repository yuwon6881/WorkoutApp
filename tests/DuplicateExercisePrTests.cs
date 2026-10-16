using Workout.Api.Domain;
using Workout.Api.Data;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class DuplicateExercisePrTests
{
    [Theory]
    [InlineData(50, 15, "reps", 1)]
    [InlineData(70, 5, "e1rm", 1)]
    [InlineData(50, 12, "both", 1)]
    [InlineData(50, 5, null, 0)]
    public async Task Only_the_block_that_earned_a_record_has_a_badge(double weight, int reps, string? kind, int count)
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        var day = new DateTime(2026, 10, 1, 10, 0, 0, DateTimeKind.Utc);
        var prior = new WorkoutSession { UserId = user.Id, Active = false, StartedAt = day.AddHours(-1), FinishedAt = day };
        var current = new WorkoutSession { UserId = user.Id, Active = false, StartedAt = day.AddDays(1).AddHours(-1), FinishedAt = day.AddDays(1) };
        h.Db.Workouts.AddRange(prior, current);
        var baseline = Block(prior, 0);
        var first = Block(current, 0);
        var second = Block(current, 1);
        h.Db.SessionExercises.AddRange(baseline, first, second);
        h.Db.Sets.AddRange(Set(baseline, 50, 5), Set(first, 50, 5), Set(second, weight, reps));
        await h.Db.SaveChangesAsync();
        var result = await WorkoutViewBuilder.ComputePrs(h.Db, [current], default);
        Assert.False(result.ExercisePrs[first.Id].IsPr);
        Assert.Equal(kind != null, result.ExercisePrs[second.Id].IsPr);
        Assert.Equal(kind, result.ExercisePrs[second.Id].PrKind);
        Assert.Equal(count, result.SessionPrCounts[current.Id]);
        Assert.Equal(kind is "reps" or "both", result.RepBests.Exercises[second.Id].IsPr);
        var cached = await WorkoutPrReadService.Get(h.Db, [current], default);
        Assert.Equal(kind, cached.ExercisePrs[second.Id].PrKind);
        // Simulate persisted summaries from the old calculator. A source-generation match
        // alone must not allow them to hide blocks after upgrading the application.
        foreach (var row in await h.Db.TrainingReadModels.ToListAsync())
        {
            row.Version = 4;
            if (row.Kind == "pr-session") row.Json = Json.Write(new WorkoutSessionPrSummary(0, [], []));
        }
        await h.Db.SaveChangesAsync();
        h.Db.ChangeTracker.Clear();
        var rebuilt = await WorkoutPrReadService.Get(h.Db, [current], default);
        Assert.Equal(kind, rebuilt.ExercisePrs[second.Id].PrKind);
        Assert.Equal(count, rebuilt.SessionPrCounts[current.Id]);
    }

    private static SessionExercise Block(WorkoutSession session, int position) => new()
    { UserId = session.UserId, SessionId = session.Id, NameSnapshot = "Bench press", Position = position, LoadModel = LoadModels.External };
    private static CompletedSet Set(SessionExercise block, double weight, int reps) => new()
    { UserId = block.UserId, SessionExerciseId = block.Id, Done = true, WeightKg = weight, Reps = reps };
}
