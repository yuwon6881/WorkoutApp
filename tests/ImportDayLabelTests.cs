using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportDayLabelTests
{
    [Fact]
    public void Printed_day_label_replaces_an_improvised_model_name()
    {
        var draft = new ImportDraft("Program", [Day(1, "Intro Week", 25)]);
        var pages = new[] { new ImportPageText(25, "DAY LABEL: LOWER 1") };

        var result = ImportDayLabels.Apply(draft, pages);

        Assert.Equal("Lower 1", Assert.Single(result.Draft.Workouts).Name);
        Assert.Contains(result.Notices, notice => notice.Code == "day_name_from_source" && notice.Severity == "info");
    }

    [Fact]
    public void Mismatched_source_label_and_training_day_counts_are_left_unchanged()
    {
        var draft = new ImportDraft("Program", [Day(1, "Model Day", 25), Day(1, "Other Model Day", 25)]);
        var pages = new[] { new ImportPageText(25, "DAY LABEL: Upper 1") };

        var result = ImportDayLabels.Apply(draft, pages);

        Assert.Equal(["Model Day", "Other Model Day"], result.Draft.Workouts.Select(day => day.Name));
        Assert.Contains(result.Notices, notice => notice.Code == "day_label_ambiguous"
            && notice.SourcePage == 25 && notice.Severity == "info");
    }

    [Fact]
    public void Multiple_labels_on_a_page_pair_with_training_days_in_printed_order()
    {
        var draft = new ImportDraft("Program", [Day(1, "Model One", 25), Day(1, "Model Two", 25)]);
        var pages = new[] { new ImportPageText(25, "DAY LABEL: LOWER 1\nDAY LABEL: UPPER 1") };

        var result = ImportDayLabels.Apply(draft, pages);

        Assert.Equal(["Lower 1", "Upper 1"], result.Draft.Workouts.Select(day => day.Name));
    }

    [Fact]
    public void Missing_training_day_names_receive_distinct_week_scoped_fallbacks()
    {
        var draft = new ImportDraft("Program", [
            Day(1, "", 25), Day(1, " ", 26), Day(2, "", 27),
            Day(1, "Rest", 28, restDay: true)
        ]);

        var result = ImportDayLabels.FillMissing(draft);

        Assert.Equal(["Week 1 day 1", "Week 1 day 2", "Week 2 day 1", "Rest"],
            result.Draft.Workouts.Select(day => day.Name));
        Assert.Single(result.Notices, notice => notice.Code == "day_name_unlabelled" && notice.Severity == "info");
    }

    [Fact]
    public void Same_source_label_keeps_recurring_slots_together_across_weeks()
    {
        var first = Day(1, "Upper 1", 25) with { Exercises = [Exercise()] };
        var second = Day(2, "Upper 1", 26) with { Exercises = [Exercise()] };
        var draft = new ImportDraft("Program", [first, second]);

        var result = ImportDayLabels.Apply(draft, [
            new ImportPageText(25, "DAY LABEL: Upper 1"),
            new ImportPageText(26, "DAY LABEL: Upper 1")
        ]);

        var days = result.Draft.Workouts;
        Assert.Equal(ImportValidation.SlotSignature(days[0], 0, days[0].Exercises[0].SourceName),
            ImportValidation.SlotSignature(days[1], 0, days[1].Exercises[0].SourceName));
    }

    [Theory]
    [InlineData("LOWER", "Lower")]
    [InlineData("LEGs #2", "Legs #2")]
    [InlineData("Arms & Weak Points #1", "Arms & Weak Points #1")]
    [InlineData("Upper (Strength Focus)", "Upper (Strength Focus)")]
    public void Labels_are_tidied_without_losing_written_structure(string input, string expected)
        => Assert.Equal(expected, ImportDayLabels.TidyLabel(input));

    private static DraftWorkout Day(int week, string name, int page, bool restDay = false)
        => new(Guid.NewGuid(), week, name, null, null, [], Block: "Block 1", IsRestDay: restDay, SourcePage: page);

    private static DraftExercise Exercise()
        => new(Guid.NewGuid(), "Barbell Row", null, null,
            [new DraftSet(8, 10, null, null, null, null, null)], SourcePage: 25);
}
