using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class WorkoutAiSchemaTests
{
    [Fact]
    public void Day_name_is_required_but_nullable_and_the_prompt_uses_marked_titles()
    {
        var day = WorkoutAiSchemas.Content.GetProperty("properties").GetProperty("days")
            .GetProperty("items");
        var dayName = day.GetProperty("properties").GetProperty("dayName");
        var types = dayName.GetProperty("type").EnumerateArray().Select(value => value.GetString()).ToList();
        var required = day.GetProperty("required").EnumerateArray().Select(value => value.GetString()).ToList();

        Assert.Equal(["string", "null"], types);
        Assert.Contains("dayName", required);
        Assert.Contains("DAY LABEL: <text>", WorkoutAiSchemas.Instructions);
        Assert.Equal("workout-import-v32-general-schedule", WorkoutAi.PromptVersion);
        Assert.Contains("1-2 REST DAYS", WorkoutAiSchemas.Instructions);
    }
}
