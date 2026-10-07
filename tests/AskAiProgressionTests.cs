using System.Text.Json;
using Workout.Api.Domain;
using Workout.Api.Services;
using Workout.Api.Services.AI;
using Workout.Api.Services.AI.Tools;
using Xunit;

namespace Workout.Tests;

/// Ask AI must be able to answer questions about one set's progression with the same evidence the
/// progression policy uses: the same set across sessions, its effort, and fatigue from earlier sets.
public sealed class AskAiProgressionTests
{
    private static async Task<Guid> TwoSetCurl(Harness h)
    {
        await h.Seed(new SeedExercise("curl", "Curl", "Biceps", "Dumbbell", null, 2.5));
        var template = await h.Templates.Create(Harness.Template("Arms",
            Harness.Exercise(await h.ExerciseId("curl"), "Curl", Harness.Set(8, 10), Harness.Set(8, 10))), null, 1, 0, default);
        return template.Id;
    }

    private static async Task Log(Harness h, SessionView session, params (double Load, int Reps, string Rir)[] sets)
    {
        var exercise = Assert.Single(session.Exercises);
        var inputs = sets.Select((set, index) => new SetInput(set.Load, set.Reps, Progression.RpeFromRir(set.Rir), true,
            Id: exercise.Sets[index].Id, Rir: set.Rir)).ToList();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription, inputs, Id: exercise.Id)],
            session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
    }

    private static async Task<JsonElement> Progress(Harness h, AiToolContext context, object args)
    {
        var result = await new GetExerciseProgressTool(h.Db).ExecuteAsync(
            AiToolArgs.Parse(JsonSerializer.Serialize(args)), context, default);
        return JsonSerializer.SerializeToElement(result.Data, Json.Options);
    }

    [Fact]
    public async Task Progress_reports_each_working_set_with_its_effort_suggestion_and_carried_over_fatigue()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await TwoSetCurl(h);
        await Log(h, await h.Workouts.Start(template, null, default), (20, 10, "2"), (20, 9, "2"));
        await Log(h, await h.Workouts.Start(template, null, default), (20, 10, "0"), (20, 6, "2"));
        var live = await h.Workouts.Start(template, null, default);
        var context = new AiToolContext("kg", new DateOnly(2026, 10, 3));

        var data = await Progress(h, context, new { exercise = "Curl" });

        var sessions = data.GetProperty("sessions");
        Assert.Equal(2, sessions.GetArrayLength());
        var newest = sessions[0].GetProperty("sets");
        Assert.Equal(1, newest[0].GetProperty("set").GetInt32());
        Assert.Equal("0", newest[0].GetProperty("rir").GetString());
        Assert.Equal("8-10 reps at RPE 8", newest[0].GetProperty("target").GetString());
        Assert.Equal(JsonValueKind.Null, newest[0].GetProperty("earlierSetsPastTargetBy").ValueKind);
        Assert.Equal(6, newest[1].GetProperty("reps").GetInt32());
        Assert.Equal(2, newest[1].GetProperty("earlierSetsPastTargetBy").GetDouble());
        Assert.False(string.IsNullOrEmpty(newest[1].GetProperty("suggestionReason").GetString()));
        // Older sessions keep the suggested numbers but not the reason text, to stay inside the result bound.
        Assert.Equal(JsonValueKind.Null, sessions[1].GetProperty("sets")[1].GetProperty("suggestionReason").ValueKind);

        var current = data.GetProperty("currentWorkout");
        Assert.Equal(live.Id.ToString(), current.GetProperty("workoutId").GetString());
        Assert.Contains("fatigue", current.GetProperty("sets")[1].GetProperty("suggestionReason").GetString());
        Assert.True(context.Evidence.Contains(AiEvidenceLedger.Workout, live.Id.ToString()));
    }

    [Fact]
    public async Task Progress_marks_truncation_only_when_older_sessions_exist_and_keeps_same_named_unresolved_work_apart()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await TwoSetCurl(h);
        for (var index = 0; index < 5; index++)
            await Log(h, await h.Workouts.Start(template, null, default), (20, 10, "2"), (20, 9, "2"));
        // An unresolved movement that merely shares the name is not the catalog exercise's history.
        var unresolved = await h.Templates.Create(Harness.Template("Other",
            Harness.Exercise(null, "Curl", Harness.Set(8, 10))), null, 1, 1, default);
        await Log(h, await h.Workouts.Start(unresolved.Id, null, default), (99, 8, "2"));
        var context = new AiToolContext("kg", new DateOnly(2026, 10, 3));

        var result = await new GetExerciseProgressTool(h.Db).ExecuteAsync(
            AiToolArgs.Parse("{\"exercise\":\"Curl\"}"), context, default);
        var sessions = JsonSerializer.SerializeToElement(result.Data, Json.Options).GetProperty("sessions");

        Assert.Equal(5, sessions.GetArrayLength());
        Assert.False(result.Truncated);
        Assert.All(sessions.EnumerateArray(), session =>
            Assert.All(session.GetProperty("sets").EnumerateArray(), set => Assert.Equal(20, set.GetProperty("weight").GetDouble())));

        await Log(h, await h.Workouts.Start(template, null, default), (20, 10, "2"), (20, 9, "2"));
        var longer = await new GetExerciseProgressTool(h.Db).ExecuteAsync(
            AiToolArgs.Parse("{\"exercise\":\"Curl\"}"), new AiToolContext("kg", new DateOnly(2026, 10, 3)), default);
        Assert.True(longer.Truncated);
    }

    [Fact]
    public async Task Progress_can_follow_one_set_and_hides_effort_when_RIR_tracking_is_off()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await TwoSetCurl(h);
        await Log(h, await h.Workouts.Start(template, null, default), (20, 10, "2"), (20, 9, "2"));
        await Log(h, await h.Workouts.Start(template, null, default), (20, 10, "0"), (20, 6, "2"));

        var data = await Progress(h, new AiToolContext("lb", new DateOnly(2026, 10, 3), trackRir: false),
            new { exercise = "Curl", setNumber = 2 });

        foreach (var session in data.GetProperty("sessions").EnumerateArray())
        {
            var set = Assert.Single(session.GetProperty("sets").EnumerateArray());
            Assert.Equal(2, set.GetProperty("set").GetInt32());
            Assert.Equal(44.1, set.GetProperty("weight").GetDouble());
            Assert.Equal(JsonValueKind.Null, set.GetProperty("rir").ValueKind);
            Assert.Equal(JsonValueKind.Null, set.GetProperty("earlierSetsPastTargetBy").ValueKind);
            Assert.Equal("8-10 reps", set.GetProperty("target").GetString());
        }
    }

    [Fact]
    public async Task The_exercise_progress_preset_seeds_arguments_the_progress_tool_accepts()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await TwoSetCurl(h);
        await Log(h, await h.Workouts.Start(template, null, default), (20, 10, "2"), (20, 9, "2"));

        var seeded = Assert.Single(AiAssistantService.BuildSeededCalls(
            new AiInvocationContext("exercises", "exercise-progress", ExerciseSlug: "curl"))!);
        Assert.Equal("get_exercise_progress", seeded.ToolName);

        // A seeded call that fails argument validation costs the user an extra model round-trip.
        var result = await new GetExerciseProgressTool(h.Db).ExecuteAsync(
            AiToolArgs.Parse(seeded.ArgumentsJson), new AiToolContext("kg", new DateOnly(2026, 10, 3)), default);
        var data = JsonSerializer.SerializeToElement(result.Data, Json.Options);
        Assert.Equal(1, data.GetProperty("sessions").GetArrayLength());
    }
}
