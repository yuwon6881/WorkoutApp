using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class HistorySummaryTests
{
    [Fact]
    public async Task Cursor_is_stable_with_tied_timestamps_and_new_completions_and_summaries_match_full_views()
    {
        await using var h = await Harness.Create(); await h.SignIn();
        var time = DateTime.UtcNow.Date;
        for (var i = 0; i < 4; i++)
        {
            var workout = new WorkoutSession { UserId = h.Db.CurrentUser!.Value, Name = $"Session {i}", Active = false,
                StartedAt = time.AddHours(-1), FinishedAt = time };
            var exercise = new SessionExercise { UserId = workout.UserId, SessionId = workout.Id, NameSnapshot = "Bench" };
            h.Db.Workouts.Add(workout); h.Db.SessionExercises.Add(exercise);
            h.Db.Sets.Add(new CompletedSet { UserId = workout.UserId, SessionExerciseId = exercise.Id, Done = true, Reps = 8,
                WeightKg = i == 0 ? null : i == 1 ? 0 : 50 });
        }
        await h.Db.SaveChangesAsync();
        var first = JsonNode.Parse(Json.Write(await HistoryReadService.Get(h.Db, null, null, 2, default)))!;
        foreach (var row in first["sessions"]!.AsArray())
        {
            var full = await h.Workouts.Get(Guid.Parse(row!["id"]!.ToString()), default);
            Assert.Equal(JsonNode.Parse(Json.Write(full))!["volumeKg"]?.ToJsonString(), row["volumeKg"]?.ToJsonString());
            Assert.Equal(full.CompletedSets, row["completedSets"]!.GetValue<int>());
            Assert.Empty(row["exercises"]!.AsArray());
        }
        var appended = new WorkoutSession { UserId = h.Db.CurrentUser!.Value, Active = false, Name = "New",
            StartedAt = time.AddDays(1), FinishedAt = time.AddDays(1).AddHours(1) };
        h.Db.Workouts.Add(appended); await h.Db.SaveChangesAsync();
        var next = JsonNode.Parse(Json.Write(await HistoryReadService.Get(h.Db,
            DateTime.Parse(first["nextBeforeAt"]!.ToString(), null, System.Globalization.DateTimeStyles.RoundtripKind), Guid.Parse(first["nextBeforeId"]!.ToString()), 2, default)))!;
        var ids = first["sessions"]!.AsArray().Concat(next["sessions"]!.AsArray()).Select(x => x!["id"]!.ToString()).ToList();
        Assert.Equal(4, ids.Distinct().Count());
        Assert.DoesNotContain(appended.Id.ToString(), ids);
        Assert.Null(next["nextBeforeId"]);
    }

    [Fact]
    public async Task Derived_records_cannot_be_written_to_another_account()
    {
        await using var h = await Harness.Create(); await h.SignIn();
        var other = await h.CreateUser("Other");
        h.Db.TrainingReadModels.Add(new TrainingReadModel { UserId = other.Id, Kind = "progress", Json = "{}" });
        await Assert.ThrowsAsync<InvalidOperationException>(() => h.Db.SaveChangesAsync());
    }
}
