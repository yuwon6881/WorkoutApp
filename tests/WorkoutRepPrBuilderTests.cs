using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class WorkoutRepPrBuilderTests
{
    private static readonly DateTime FirstFinish = new(2026, 9, 1, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid ExerciseId = Guid.Parse("10000000-0000-0000-0000-000000000001");

    [Fact]
    public void High_rep_records_compare_the_same_exercise_load_and_resistance_mode()
    {
        var firstSession = Guid.NewGuid();
        var secondSession = Guid.NewGuid();
        var exposures = new[]
        {
            Exposure(firstSession, FirstFinish, 0, 50, 12),
            Exposure(secondSession, FirstFinish.AddDays(1), 0, 50, 15),
            Exposure(secondSession, FirstFinish.AddDays(1), 1, 50, 16),
            Exposure(secondSession, FirstFinish.AddDays(1), 2, 50, 16)
        };

        var result = WorkoutRepPrBuilder.Build(exposures);

        Assert.False(result.Exercises[Exercise(firstSession)].IsPr);
        Assert.True(result.Exercises[Exercise(secondSession)].IsPr);
        Assert.Equal("reps", result.Exercises[Exercise(secondSession)].Kind);
        Assert.Equal(16, result.Exercises[Exercise(secondSession)].Reps);
        Assert.Equal(1, result.SessionCounts[secondSession]);
        Assert.True(result.Sets[Set(secondSession, 0)].IsPr);
        Assert.True(result.Sets[Set(secondSession, 1)].IsPr);
        Assert.False(result.Sets[Set(secondSession, 2)].IsPr);
    }

    [Fact]
    public void Full_bodyweight_records_need_frozen_system_load_and_keep_resistance_modes_separate()
    {
        Assert.Null(WorkoutRepPrBuilder.LoadKey(LoadModels.FullBodyweight, ResistanceModes.Bodyweight, null, null));
        var bodyweight = WorkoutRepPrBuilder.LoadKey(LoadModels.FullBodyweight, ResistanceModes.Bodyweight, null, 82.34567);
        var added = WorkoutRepPrBuilder.LoadKey(LoadModels.FullBodyweight, ResistanceModes.Added, 10, 82.34567);
        var assisted = WorkoutRepPrBuilder.LoadKey(LoadModels.FullBodyweight, ResistanceModes.Assistance, 10, 82.34567);

        Assert.Equal(82.3457, bodyweight!.LoadKg);
        Assert.Equal(82.3457, added!.LoadKg);
        Assert.NotEqual(bodyweight, added);
        Assert.NotEqual(added, assisted);
        Assert.Null(WorkoutRepPrBuilder.LoadKey(LoadModels.External, ResistanceModes.External, null, 82));
    }

    [Fact]
    public void Full_bodyweight_rep_prs_compare_only_with_the_same_resistance_convention()
    {
        var bodyweightSession = Guid.NewGuid();
        var addedSession = Guid.NewGuid();
        var improvedAddedSession = Guid.NewGuid();
        var exposures = new[]
        {
            Exposure(bodyweightSession, FirstFinish, 0, null, 10, ResistanceModes.Bodyweight, LoadModels.FullBodyweight, 85),
            Exposure(addedSession, FirstFinish.AddDays(1), 0, 10, 15, ResistanceModes.Added, LoadModels.FullBodyweight, 85),
            Exposure(improvedAddedSession, FirstFinish.AddDays(2), 0, 10, 16, ResistanceModes.Added, LoadModels.FullBodyweight, 85)
        };

        var result = WorkoutRepPrBuilder.Build(exposures);

        Assert.False(result.Exercises[Exercise(addedSession)].IsPr);
        Assert.True(result.Exercises[Exercise(improvedAddedSession)].IsPr);
        Assert.Equal(1, result.SessionCounts[improvedAddedSession]);
    }

    [Fact]
    public void Reps_only_records_are_independent_of_weight_and_other_load_models()
    {
        var repsOnly = WorkoutRepPrBuilder.LoadKey(LoadModels.RepsOnly, ResistanceModes.RepsOnly, null, null);
        var bodyweightContext = WorkoutRepPrBuilder.LoadKey(LoadModels.BodyweightContextOnly, ResistanceModes.RepsOnly, null, null);
        Assert.Null(repsOnly!.LoadKg);
        Assert.Null(bodyweightContext!.LoadKg);
        Assert.NotEqual(repsOnly, bodyweightContext);
    }

    private static WorkoutRepExposure Exposure(
        Guid sessionId, DateTime finishedAt, int position, double? weightKg, int reps,
        string resistanceMode = ResistanceModes.External, string loadModel = LoadModels.External, double? systemLoadKg = null)
    {
        var sessionExerciseId = Exercise(sessionId);
        return new WorkoutRepExposure(sessionId, finishedAt, finishedAt.AddMinutes(-30),
            WorkoutViewBuilder.PrKey(ExerciseId, "Bench press"), sessionExerciseId,
            Set(sessionId, position), position, loadModel, resistanceMode, weightKg, systemLoadKg, reps);
    }

    private static Guid Exercise(Guid sessionId) => Derived(sessionId, 254);
    private static Guid Set(Guid sessionId, int position) => Derived(sessionId, position + 1);

    private static Guid Derived(Guid source, int suffix)
    {
        var bytes = source.ToByteArray();
        bytes[15] = (byte)suffix;
        return new Guid(bytes);
    }
}
