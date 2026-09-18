using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Unknown load stays unknown, which means a finished session can hold completed sets and still
/// not state a single load. Every other record on the insight screen already reads as absent in
/// that case; the rep PR read the empty result as if it had a set behind it and crashed the whole
/// request with a NullReferenceException, taking the history and the chart down with it.
public sealed class ExerciseInsightTests
{
    private static async Task<(Harness h, Guid templateId, Guid benchId)> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        var benchId = await h.ExerciseId("bench");
        var template = await h.Templates.Create(
            Harness.Template("Push", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);
        return (h, template.Id, benchId);
    }

    [Fact]
    public async Task A_finished_session_whose_sets_state_no_load_reports_records_as_absent()
    {
        var (h, templateId, benchId) = await Ready();
        await using var _h = h;
        var exercises = new ExerciseService(h.Db);
        var session = await h.Workouts.Start(templateId, null, default);
        // Ten reps logged, the load never written down.
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)],
                [new SetInput(null, 10, null, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var insight = await exercises.Insight(benchId, "3m", 0, 20, default);

        Assert.Equal(1, insight.Sessions);
        Assert.Equal(1, insight.SetCount);
        Assert.Null(insight.RepPr);
        Assert.Null(insight.RepPrDate);
        Assert.Null(insight.HeaviestKg);
        Assert.Null(insight.LargestSetVolumeKg);
        // The session itself is still history, and it is honest about the missing load.
        Assert.Single(insight.History);
        Assert.True(insight.PartialVolume);
    }

    [Fact]
    public async Task A_logged_load_still_produces_a_rep_record()
    {
        var (h, templateId, benchId) = await Ready();
        await using var _h = h;
        var exercises = new ExerciseService(h.Db);
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(benchId, "Bench press", null, [Harness.Set(8, 10)],
                [new SetInput(60, 10, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var insight = await exercises.Insight(benchId, "3m", 0, 20, default);

        Assert.Equal(10, insight.RepPr);
        Assert.NotNull(insight.RepPrDate);
        Assert.Equal(60, insight.HeaviestKg);
    }
}
