using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A written program almost never names weekdays; it prints a week as an ordered list, and the
/// order is the schedule. Asking a reviewer to choose a weekday for each day turned a ninety-day
/// program into ninety blocking questions with one obvious answer each.
public sealed class ImportScheduleTests
{
    private static DraftWorkout Day(string name, int week, int? weekday = null, bool rest = false)
        => new(Guid.NewGuid(), week, name, null, null, rest ? [] : [new DraftExercise(Guid.NewGuid(), "Bench press", null, null,
            [new DraftSet(5, 8, 8, 120, null, null, null)], "A1", [], 1)], "Block 1", "Main", week, rest, weekday);

    [Fact]
    public void Five_sessions_run_monday_to_friday_and_leave_the_weekend_free()
    {
        var week = ImportSchedule.Assign([
            Day("Push", 1), Day("Pull", 1), Day("Legs", 1), Day("Upper", 1), Day("Lower", 1)
        ]);

        Assert.Equal([1, 2, 3, 4, 5], week.Select(day => day.Weekday));
    }

    [Fact]
    public void A_rest_day_the_document_printed_takes_its_turn_like_any_other()
    {
        var week = ImportSchedule.Assign([
            Day("Upper 1", 1), Day("Lower 1", 1), Day("Rest", 1, rest: true),
            Day("Upper 2", 1), Day("Lower 2", 1), Day("Rest", 1, rest: true), Day("Rest", 1, rest: true)
        ]);

        // Wednesday is the rest day the page printed, and the sessions fall either side of it.
        Assert.Equal([1, 2, 3, 4, 5, 6, 7], week.Select(day => day.Weekday));
    }

    [Fact]
    public void A_weekday_the_document_stated_is_kept_and_the_days_around_it_fill_in()
    {
        var week = ImportSchedule.Assign([
            Day("Upper", 1), Day("Lower", 1, weekday: 5), Day("Arms", 1)
        ]);

        Assert.Equal([1, 5, 6], week.Select(day => day.Weekday));
    }

    [Fact]
    public void Each_week_starts_over_on_monday()
    {
        var weeks = ImportSchedule.Assign([
            Day("Upper", 1), Day("Lower", 1), Day("Upper", 2), Day("Lower", 2)
        ]);

        Assert.Equal([1, 2, 1, 2], weeks.Select(day => day.Weekday));
    }

    [Fact]
    public void A_week_holding_more_sessions_than_a_week_has_days_places_what_it_can()
    {
        var week = ImportSchedule.Assign(Enumerable.Range(1, 9).Select(index => Day($"Day {index}", 1)).ToList());

        // Seven placed, and the rest left unplaced rather than stacked onto a day already taken.
        Assert.Equal([1, 2, 3, 4, 5, 6, 7, null, null], week.Select(day => day.Weekday));
    }
}
