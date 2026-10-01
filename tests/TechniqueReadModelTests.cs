using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class TechniqueReadModelTests
{
    [Fact]
    public async Task Old_record_snapshots_are_rebuilt_even_without_a_new_history_mutation()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var (session, exercise, set) = await TechniqueSession(h);
        var generation = await h.Db.ResourceGenerations.AsNoTracking().SingleAsync();
        h.Db.TrainingReadModels.AddRange(
            new TrainingReadModel
            {
                UserId = h.Db.CurrentUser!.Value, Kind = "pr-baseline", SourceId = Guid.Empty,
                Version = 1, Generation = generation.History,
                Json = Json.Write(new WorkoutPrBaseline([new(Guid.Empty, "Curl", 999)], [],
                    session.FinishedAt, session.StartedAt, generation.History))
            },
            new TrainingReadModel
            {
                UserId = h.Db.CurrentUser!.Value, Kind = "pr-session", SourceId = session.Id,
                Version = 1, Generation = generation.History,
                Json = Json.Write(new WorkoutSessionPrSummary(1,
                    [new(exercise.Id, true, 999, "both", 30)], [new(set.Id, true, 999, "both", 30)]))
            });
        await h.Db.SaveChangesAsync();

        // Reads happen in a fresh request context, with no fixture-owned snapshots tracked.
        h.Db.ChangeTracker.Clear();

        var result = await WorkoutPrReadService.Get(h.Db, [session], default);

        Assert.Empty(result.Bests);
        Assert.Equal(0, result.SessionPrCounts.GetValueOrDefault(session.Id));
        Assert.False(result.SetPrs.GetValueOrDefault(set.Id).IsPr);
    }

    [Fact]
    public async Task Old_progress_snapshots_are_rebuilt_with_technique_volume_and_no_strength_record()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await TechniqueSession(h);
        var generation = await h.Db.ResourceGenerations.AsNoTracking().SingleAsync();
        h.Db.TrainingReadModels.Add(new TrainingReadModel
        {
            UserId = h.Db.CurrentUser!.Value, Kind = "progress", SourceId = Guid.Empty,
            Version = 1, Generation = generation.Progress,
            Json = Json.Write(new { Date = DateTime.UtcNow.ToString("yyyy-MM-dd"), Value = new { workingSets = 999 } })
        });
        await h.Db.SaveChangesAsync();
        h.Db.ChangeTracker.Clear();
        using var cache = new MemoryCache(new MemoryCacheOptions());

        var result = JsonSerializer.SerializeToElement(await ProgressReadService.Get(h.Db, cache, default), Json.Options);

        Assert.Equal(1, result.GetProperty("workingSets").GetInt32());
        Assert.Equal(1500, result.GetProperty("totalVolumeKg").GetDouble());
        Assert.Equal(JsonValueKind.Null, result.GetProperty("exercises")[0].GetProperty("heaviestKg").ValueKind);
    }

    private static async Task<(WorkoutSession Session, SessionExercise Exercise, CompletedSet Set)> TechniqueSession(Harness h)
    {
        var user = h.Db.CurrentUser!.Value;
        var finished = DateTime.UtcNow.AddDays(-1);
        var session = new WorkoutSession
        {
            UserId = user, Active = false, Name = "Technique session",
            StartedAt = finished.AddMinutes(-30), FinishedAt = finished
        };
        var exercise = new SessionExercise
        {
            UserId = user, SessionId = session.Id, NameSnapshot = "Curl",
            PrescriptionJson = Json.Write(new[] { Harness.Set(8, 10) with { Notes = "Lengthened partials" } })
        };
        var set = new CompletedSet
        {
            UserId = user, SessionExerciseId = exercise.Id, Position = 0, Done = true,
            WeightKg = 50, Reps = 30, Rpe = 10
        };
        h.Db.Workouts.Add(session);
        h.Db.SessionExercises.Add(exercise);
        h.Db.Sets.Add(set);
        await h.Db.SaveChangesAsync();
        return (session, exercise, set);
    }
}
