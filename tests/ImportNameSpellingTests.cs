using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Forearm Hypertrophy prints each week on one page (Day 1, Day 2, Day 3) and repeats
/// "DUMBBELL BENCH-BRACED WRIST CURL" in Day 1 and Day 3 at different reps. With two rows by one
/// name, neither day's read was checked against the page, and week 4 kept the read's title case.
public sealed class ImportNameSpellingTests
{
    private const string WeekPage = """
        === PAGE 9 ===
        PROGRAM : WEEK 4
        DAY LABEL: DAY 1
        Exercise | SETS | REPS | HOLD | RPE | REST | NOTES
        DUMBBELL BENCH-BRACED WRIST CURL | 3 | 10-12 | - | 8 | 30 SEC | Thumbless grip
        DAY LABEL: DAY 3
        Exercise | SETS | REPS | HOLD | RPE | REST | NOTES
        DUMBBELL BENCH-BRACED WRIST CURL | 2 | 15-20 | - | 8 | 1 MIN | Thumbless grip
        """;

    private static AiDay Day(string name) => new(null, null, 4, 4, name, false, null,
        [new AiExercise("Dumbbell Bench-Braced Wrist Curl", null, null, [new AiSet(1, 1, null, null, null, null, null)], SourcePage: 9)], 9);

    [Fact]
    public void Each_day_on_a_whole_week_page_reads_the_row_under_its_own_label()
    {
        var days = ImportTableEvidence.Enrich(new AiProgram("Forearm", [Day("Day 1"), Day("Day 3")]), WeekPage).Days!;

        var first = Assert.Single(days[0].Exercises);
        var third = Assert.Single(days[1].Exercises);
        Assert.Equal("DUMBBELL BENCH-BRACED WRIST CURL", first.SourceName);
        Assert.Equal("DUMBBELL BENCH-BRACED WRIST CURL", third.SourceName);
        Assert.Equal(3, first.Sets.Count);
        Assert.Equal((10, 12), (first.Sets[0].RepMin, first.Sets[0].RepMax));
        Assert.Equal(2, third.Sets.Count);
        Assert.Equal((15, 20), (third.Sets[0].RepMin, third.Sets[0].RepMax));
    }

    [Fact]
    public void One_movement_keeps_the_spelling_its_pages_print()
    {
        DraftWorkout Workout(int week, string name) => new(Guid.NewGuid(), week, "Day 1", null, null,
            [new DraftExercise(Guid.NewGuid(), name, null, null, [new DraftSet(10, 12, 8, 30, null, null, null)])]);
        var draft = new ImportDraft("Forearm", [
            Workout(1, "DUMBBELL BENCH-BRACED WRIST CURL"), Workout(2, "Dumbbell Bench-Braced Wrist Curl"),
            Workout(3, "Dumbbell Bench-Braced Wrist Curl"), Workout(4, "Behind-the-Back Dumbbell Wrist Curl")]);

        var standardized = ImportNameSpelling.Standardize(draft, [new ImportPageText(9, WeekPage)]);

        Assert.Equal(["DUMBBELL BENCH-BRACED WRIST CURL", "DUMBBELL BENCH-BRACED WRIST CURL", "DUMBBELL BENCH-BRACED WRIST CURL",
            "Behind-the-Back Dumbbell Wrist Curl"], standardized.Workouts.Select(workout => workout.Exercises[0].SourceName));
    }
}
