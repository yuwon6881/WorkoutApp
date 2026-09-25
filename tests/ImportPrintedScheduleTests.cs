using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The week headings, day labels and rest bands a PDF prints on its training pages place the
/// draft's days; a read's own week numbers and rest slots are only the fallback.
public sealed class ImportPrintedScheduleTests
{
    private static ImportPageText Page(int number, int week, string label, bool rest = false)
        => new(number, $"WEEK {week}\nDAY LABEL: {label}\nExercise | Working Sets | Reps\nSquat | 3 | 5{(rest ? "\n1-2 Rest Days" : "")}");

    private static DraftWorkout Day(int week, string name, int page) => new(Guid.NewGuid(), week, name, null, null, [], SourcePage: page);
    private static DraftWorkout Rest(int week, int page) => new(Guid.NewGuid(), week, "Rest Day", null, null, [], IsRestDay: true, SourcePage: page);

    [Fact]
    public void A_rest_day_read_in_the_wrong_slot_moves_to_the_band_that_prints_it()
    {
        // Min-Max Phase 2 week 5: the band follows Lower and Arms, but the read put a rest after Push.
        List<ImportPageText> pages = [Page(30, 1, "Upper"), Page(31, 1, "Lower", rest: true), Page(32, 1, "Push"), Page(33, 1, "Arms", rest: true)];
        var upper = Day(1, "Upper", 30);
        var lower = Day(1, "Lower", 31);
        var push = Day(1, "Push", 32);
        var arms = Day(1, "Arms", 33);
        var misplaced = Rest(1, 31);

        var placed = ImportPrintedSchedule.Read(pages)!.Reconcile([upper, lower, push, misplaced, arms]).Workouts!;

        Assert.Equal(["Upper", "Lower", "Rest Day", "Push", "Arms", "Rest Day"], placed.Select(day => day.Name));
        Assert.Equal(misplaced.LineId, placed[2].LineId);
        Assert.True(placed[5].IsRestDay);
    }

    [Fact]
    public void Days_read_under_the_wrong_week_take_their_printed_week()
    {
        // Chest Hypertrophy prints "WEEK" and "01" as two stacked lines.
        List<ImportPageText> pages = [new(6, "WEEK\n01\nDAY LABEL: Day 1\nDAY LABEL: Day 2"), new(7, "WEEK\n02\nDAY LABEL: Day 1\nDAY LABEL: Day 2")];
        var draft = new List<DraftWorkout> { Day(1, "Day 1", 6), Day(1, "Day 2", 6), Day(1, "Day 1", 7), Day(1, "Day 2", 7) };

        var placed = ImportPrintedSchedule.Read(pages)!.Reconcile(draft);

        Assert.Equal([1, 1, 2, 2], placed.Workouts!.Select(day => day.Week));
        Assert.Contains(placed.Notices, notice => notice.Code == "printed_schedule_used");
    }

    [Fact]
    public void A_session_the_read_missed_is_recovered_from_its_clean_printed_table()
    {
        const string text = """
            === PAGE 12 ===
            WEEK 1
            DAY LABEL: Push
            Exercise | Working Sets | Reps | RPE | Rest
            Bench Press | 3 | 6-8 | 8 | 3 min
            DAY LABEL: Pull
            Exercise | Working Sets | Reps | RPE | Rest
            Barbell Row | 3 | 8-10 | 8 | 2 min
            Lat Pulldown | 2 | 10-12 | 9 | 90 sec
            """;
        var read = new AiProgram("PPL", [new AiDay(null, null, 1, 1, "Push", false, null,
            [new AiExercise("Bench Press", null, null, [new AiSet(6, 8, 8, 180, null, null, null)], SourcePage: 12)], 12)]);

        var days = ImportTableEvidence.Enrich(read, text).Days!;

        Assert.Equal(["Push", "Pull"], days.Select(day => day.DayName));
        Assert.Equal(["Barbell Row", "Lat Pulldown"], days[1].Exercises.Select(exercise => exercise.SourceName));
        Assert.Equal((1, 12), (days[1].WeekNumber, days[1].SourcePage));
    }

    [Fact]
    public void A_training_page_without_a_week_heading_leaves_the_schedule_unread()
    {
        List<ImportPageText> pages = [Page(30, 1, "Upper"), new(31, "DAY LABEL: Lower\nSquat | 3 | 5")];

        Assert.Null(ImportPrintedSchedule.Read(pages));
    }

    [Fact]
    public void A_week_one_reprinted_without_a_new_phase_banner_is_not_a_new_phase()
    {
        List<ImportPageText> appendix = [Page(30, 1, "Upper"), Page(31, 2, "Upper"), Page(80, 1, "Upper")];
        List<ImportPageText> phased = [Page(30, 1, "Upper"), Page(31, 2, "Upper"), new(40, "Phase 2"), Page(41, 1, "Upper")];

        Assert.Null(ImportPrintedSchedule.Read(appendix));
        var schedule = ImportPrintedSchedule.Read(phased)!;
        Assert.Equal([1, 2, 3], schedule.Days.Select(day => day.Week));
        Assert.Equal(("Phase 2", 1), (schedule.Days[2].Block, schedule.Days[2].PhaseWeek));
    }

    [Fact]
    public void An_unbannered_week_restart_does_not_discard_later_schedule_pages()
    {
        List<ImportPageText> pages = [Page(30, 1, "Upper"), Page(31, 2, "Lower"), Page(32, 1, "Example")];

        Assert.Null(ImportPrintedSchedule.Read(pages));
    }

    [Fact]
    public void A_standalone_rest_session_keeps_the_week_printed_on_its_own_page()
    {
        List<ImportPageText> pages = [
            Page(30, 1, "Upper"),
            new(31, "WEEK 2\nDAY LABEL: Rest Day\nNO PHYSICAL ACTIVITY"),
            Page(32, 2, "Lower")
        ];
        var draft = new List<DraftWorkout> { Day(1, "Upper", 30), Rest(2, 31), Day(2, "Lower", 32) };

        var placed = ImportPrintedSchedule.Read(pages)!.Reconcile(draft).Workouts!;

        Assert.Equal([1, 2, 2], placed.Select(day => day.Week));
        Assert.True(placed[1].IsRestDay);
        Assert.Equal(31, placed[1].SourcePage);
    }

    [Fact]
    public void A_ten_day_printed_cycle_stays_in_its_printed_week()
    {
        var pages = Enumerable.Range(0, 8).Select(index => Page(20 + index, 1, $"Day {index + 1}", rest: index is 3 or 7)).ToList();
        var draft = Enumerable.Range(0, 8).Select(index => Day(index < 7 ? 1 : 2, $"Day {index + 1}", 20 + index)).ToList();

        var placed = ImportPrintedSchedule.Read(pages)!.Reconcile(draft).Workouts!;

        Assert.Equal(10, placed.Count);
        Assert.All(placed, day => Assert.Equal(1, day.Week));
        Assert.Equal([4, 9], placed.Select((day, index) => (day, index)).Where(item => item.day.IsRestDay).Select(item => item.index));
    }

    [Fact]
    public void A_warmup_day_read_before_the_schedule_is_left_out_and_reported()
    {
        List<ImportPageText> pages = [Page(30, 1, "Upper"), Page(31, 1, "Lower")];
        var warmup = Day(1, "Week 1 day 1", 15);

        var placed = ImportPrintedSchedule.Read(pages)!.Reconcile([warmup, Day(1, "Upper", 30), Day(1, "Lower", 31)]);

        Assert.Equal(["Upper", "Lower"], placed.Workouts!.Select(day => day.Name));
        var notice = Assert.Single(placed.Notices);
        Assert.Equal(("printed_schedule_lead_left_out", "info", 15), (notice.Code, notice.Severity, notice.SourcePage));
    }

    [Fact]
    public void A_day_on_a_page_the_schedule_does_not_print_leaves_the_draft_unchanged()
    {
        List<ImportPageText> pages = [Page(30, 1, "Upper"), Page(31, 1, "Lower")];

        var placed = ImportPrintedSchedule.Read(pages)!.Reconcile([Day(1, "Upper", 30), Day(1, "Lower", 31), Day(1, "Bonus", 90)]);

        Assert.Null(placed.Workouts);
        Assert.Empty(placed.Notices);
    }

    [Fact]
    public void A_printed_session_the_draft_lacks_is_reported_and_the_draft_left_alone()
    {
        List<ImportPageText> pages = [new(30, "WEEK 1\nDAY LABEL: Upper\nDAY LABEL: Lower"), Page(31, 1, "Push")];

        var placed = ImportPrintedSchedule.Read(pages)!.Reconcile([Day(1, "Upper", 30), Day(1, "Push", 31)]);

        Assert.Null(placed.Workouts);
        Assert.Equal(("printed_schedule_mismatch", "warning", 30), (placed.Notices[0].Code, placed.Notices[0].Severity, placed.Notices[0].SourcePage));
    }
}
