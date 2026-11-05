using System.Text.Json;
using Workout.Api.Domain;
using Workout.Api.Services;
using Workout.Api.Services.AI;
using Workout.Api.Services.AI.Tools;
using Xunit;

namespace Workout.Tests;

/// Ask AI coaches from more than the latest few sessions: the exercise's all-time records, the
/// user's own workout notes, and why each earlier step of one set was suggested.
public sealed class AskAiCoachingContextTests
{
    private static readonly DateOnly Today = new(2026, 10, 3);

    private static async Task<Guid> TwoSetCurl(Harness h)
    {
        await h.Seed(new SeedExercise("curl", "Curl", "Biceps", "Dumbbell", null, 2.5));
        var template = await h.Templates.Create(Harness.Template("Arms",
            Harness.Exercise(await h.ExerciseId("curl"), "Curl", Harness.Set(8, 10), Harness.Set(8, 10))), null, 1, 0, default);
        return template.Id;
    }

    private static async Task<Guid> Log(Harness h, Guid template, string? note, params (double Load, int Reps, string Rir)[] sets)
    {
        var session = await h.Workouts.Start(template, null, default);
        var exercise = Assert.Single(session.Exercises);
        var inputs = sets.Select((set, index) => new SetInput(set.Load, set.Reps, Progression.RpeFromRir(set.Rir), true,
            Id: exercise.Sets[index].Id, Rir: set.Rir)).ToList();
        await h.Workouts.Save(session.Id, new SessionInput(note,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription, inputs, Id: exercise.Id)],
            session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
        return session.Id;
    }

    private static JsonElement Data(AiToolResult result) => JsonSerializer.SerializeToElement(result.Data, Json.Options);

    [Fact]
    public async Task Progress_reports_all_time_records_beyond_the_listed_sessions()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await TwoSetCurl(h);
        // The record session is the oldest, so it falls outside a one-session focus window.
        await Log(h, template, null, (25, 8, "1"), (25, 7, "1"));
        for (var index = 0; index < 5; index++) await Log(h, template, null, (20, 10, "2"), (20, 9, "2"));

        var data = Data(await new GetExerciseProgressTool(h.Db).ExecuteAsync(
            AiToolArgs.Parse("{\"exercise\":\"Curl\"}"), new AiToolContext("kg", Today), default));

        Assert.Equal(5, data.GetProperty("sessions").GetArrayLength());
        var records = data.GetProperty("allTimeRecords");
        Assert.Equal(6, records.GetProperty("sessions").GetInt32());
        Assert.Equal(25, records.GetProperty("heaviestSet").GetProperty("weight").GetDouble());
        Assert.Equal(8, records.GetProperty("heaviestSet").GetProperty("reps").GetInt32());
        Assert.Equal(10, records.GetProperty("mostReps").GetProperty("value").GetDouble());
        Assert.Equal(380, records.GetProperty("bestSessionVolume").GetProperty("value").GetDouble());
        Assert.True(records.GetProperty("bestEstimated1rm").GetProperty("value").GetDouble() > 25);
        Assert.NotNull(records.GetProperty("firstLogged").GetString());
    }

    [Fact]
    public async Task Progress_without_history_has_no_records()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await TwoSetCurl(h);

        var data = Data(await new GetExerciseProgressTool(h.Db).ExecuteAsync(
            AiToolArgs.Parse("{\"exercise\":\"Curl\"}"), new AiToolContext("kg", Today), default));

        Assert.Equal(JsonValueKind.Null, data.GetProperty("allTimeRecords").ValueKind);
    }

    [Fact]
    public async Task Following_one_set_keeps_the_suggestion_reason_of_every_session()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await TwoSetCurl(h);
        await Log(h, template, null, (20, 10, "2"), (20, 9, "2"));
        await Log(h, template, null, (20, 10, "2"), (20, 10, "2"));
        await Log(h, template, null, (22.5, 9, "2"), (22.5, 8, "2"));

        var data = Data(await new GetExerciseProgressTool(h.Db).ExecuteAsync(
            AiToolArgs.Parse("{\"exercise\":\"Curl\",\"setNumber\":2}"), new AiToolContext("kg", Today), default));

        var sessions = data.GetProperty("sessions");
        Assert.Equal(3, sessions.GetArrayLength());
        // The two sessions that started from history both explain their suggestion, not just the newest.
        foreach (var session in sessions.EnumerateArray().Take(2))
            Assert.False(string.IsNullOrEmpty(Assert.Single(session.GetProperty("sets").EnumerateArray())
                .GetProperty("suggestionReason").GetString()));
    }

    [Fact]
    public async Task Workout_notes_reach_history_shortened_and_detail_in_full()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await TwoSetCurl(h);
        var note = "Left elbow ached on the second set; slept five hours. " + new string('x', 300);
        var noted = await Log(h, template, note, (20, 10, "2"), (20, 9, "2"));
        await Log(h, template, "   ", (20, 10, "2"), (20, 9, "2"));
        var context = new AiToolContext("kg", Today);

        var history = Data(await new GetWorkoutHistoryTool(h.Db).ExecuteAsync(AiToolArgs.Parse("{}"), context, default))
            .GetProperty("workouts");
        Assert.Equal(JsonValueKind.Null, history[0].GetProperty("note").ValueKind);
        var shortened = history[1].GetProperty("note").GetString()!;
        Assert.StartsWith("Left elbow ached", shortened);
        Assert.True(shortened.Length <= 160);
        Assert.EndsWith("…", shortened);

        var detail = Data(await new GetWorkoutDetailTool(h.Db).ExecuteAsync(
            AiToolArgs.Parse(JsonSerializer.Serialize(new { workoutId = noted.ToString() })), context, default));
        Assert.Equal(note, detail.GetProperty("note").GetString());
    }
}
