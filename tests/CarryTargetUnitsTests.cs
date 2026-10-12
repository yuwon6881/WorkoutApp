using System.Text.Json;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class CarryTargetUnitsTests
{
    [Theory]
    [InlineData("40", "40 TOTAL STRIDES", "40 strides")]
    [InlineData("40", "Walk 40 steps", "40 steps")]
    [InlineData("40", "Carry for 40 metres", "40 metres")]
    [InlineData("40 sec", "40 TOTAL STRIDES", "40 sec")]
    [InlineData("40", "Warm up for 20 steps", "40")]
    [InlineData("40", "No count or distance is stated", "40")]
    [InlineData("50", "40 TOTAL STRIDES", "50")]
    public void Preserves_source_units_without_overwriting_explicit_time(string printed, string note, string expected)
        => Assert.Equal(expected, CarryTargetUnits.Text(printed, 40, 40, "Farmer's Walk", note));

    [Fact]
    public async Task Saved_bare_stride_target_is_qualified_on_start_refresh_and_finish_without_changing_logged_time()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("farmer-s-walk", "Farmer's Walk", "Forearms", "Dumbbell", null,
            TrackingMode: TrackingModes.Duration));
        var id = await h.ExerciseId("farmer-s-walk");
        var set = new SetPrescription(40, 40, 8, 60, null, null, null, RepsText: "40");
        var input = new TemplateInput("Arm", null, null,
            [new TemplateExerciseInput(id, "FARMERS WALKS", "LIFT HEAVY DUMBBELLS FOR 40 TOTAL STRIDES", [set])], null, null);
        var template = await h.Templates.Create(input, null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var exercise = Assert.Single(session.Exercises);
        Assert.Equal(TrackingModes.Duration, exercise.TrackingMode);
        Assert.Equal("40 strides", Assert.Single(exercise.Prescription).RepsText);
        Assert.Null(Assert.Single(exercise.Sets).Reps);
        var refreshed = await h.Workouts.Get(session.Id, default);
        Assert.Equal("40 strides", refreshed.Exercises.Single().Prescription.Single().RepsText);
        using var patch = JsonDocument.Parse($$"""
            {"revision":{{refreshed.Revision}},"mutationId":"{{Guid.NewGuid()}}","weightKg":20,"durationSeconds":23,"done":true}
            """);
        var logged = await h.Workouts.PatchSet(session.Id, exercise.Sets.Single().Id, patch.RootElement.Clone(), default);
        var finished = await h.Workouts.Finish(session.Id, logged.Revision, default);
        Assert.Equal(23, finished.Exercises.Single().Sets.Single().DurationSeconds);
        Assert.Equal("40 strides", finished.Exercises.Single().Prescription.Single().RepsText);
        Assert.Null(finished.VolumeKg);
        Assert.False(finished.Exercises.Single().IsPr);
    }
}
