using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportScheduleLabelsTests
{
    [Theory]
    [InlineData("Suggested Rest Day")]
    [InlineData("Mandatory Rest Day")]
    [InlineData("Rest Day")]
    public void Recognized_schedule_rest_labels_become_empty_rest_days(string label)
    {
        var input = new DraftWorkout(Guid.NewGuid(), 1, label, null, null, []);

        var result = ImportDayShape.Reconcile([input]);

        var rest = Assert.Single(result.Workouts);
        Assert.True(rest.IsRestDay);
        Assert.Empty(rest.Exercises);
        Assert.Empty(result.Notices);
    }

    [Theory]
    [InlineData("Suggested Rest Day")]
    [InlineData("Mandatory Rest Day")]
    public void Rest_label_read_as_an_exercise_is_removed_without_dropping_the_training_day(string label)
    {
        var input = new DraftWorkout(Guid.NewGuid(), 1, "Day 1 Upper", null, null,
        [
            new DraftExercise(Guid.NewGuid(), "Bench Press", null, null,
                [new DraftSet(5, 8, 8, 120, null, null, null)], SourcePage: 3),
            new DraftExercise(Guid.NewGuid(), label, null, null, [], SourcePage: 3)
        ], SourcePage: 3);

        var result = ImportDayShape.Reconcile([input]);

        Assert.Single(result.Workouts[0].Exercises);
        Assert.Equal("Bench Press", result.Workouts[0].Exercises[0].SourceName);
        var rest = Assert.Single(result.Workouts.Skip(1));
        Assert.True(rest.IsRestDay);
        Assert.Empty(rest.Exercises);
    }
}
