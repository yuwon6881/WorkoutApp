using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Min-Max Phase 2 (5x) prints each week as Upper, Lower + rest band, Push, Pull, Arms + rest band,
/// one session per page. Week 5 was read with its second rest day ahead of Arms.
public sealed class ImportRestSlotTests
{
    private static readonly (string Name, int Page, bool Band)[] Week =
        [("Upper", 46, false), ("Lower", 47, true), ("Push", 48, false), ("Pull", 49, false), ("Arms", 50, true)];

    private static string Pages() => string.Join("\n", Week.Select(day =>
        $"=== PAGE {day.Page} ===\nWEEK 5\nDAY LABEL: {day.Name}\nExercise | Sets | Reps | RPE | Rest\n{day.Name} Row | 3 | 8-10 | 8 | 2 min" +
        (day.Band ? "\nRest Day" : "")));

    private static AiDay Training(string name, int page) => new("Block 1", null, 5, 5, name, false, null,
        [new AiExercise($"{name} Row", null, null, [new AiSet(8, 10, 8, 120, null, null, null)], SourcePage: page)], page);

    private static AiDay Rest(int page) => new("Block 1", null, 5, 5, "Rest Day", true, null, [], page);

    [Fact]
    public void A_rest_day_read_ahead_of_its_session_moves_after_the_page_that_prints_its_band()
    {
        var read = new List<AiDay>
        {
            Training("Upper", 46), Training("Lower", 47), Rest(47), Training("Push", 48), Training("Pull", 49),
            Rest(50), Training("Arms", 50)
        };

        var days = ImportTableEvidence.Enrich(new AiProgram("Min-Max", read), Pages()).Days!;

        Assert.Equal(["Upper", "Lower", "Rest Day", "Push", "Pull", "Arms", "Rest Day"], days.Select(day => day.DayName));
    }

    [Fact]
    public void A_band_whose_rest_day_the_read_dropped_gains_one()
    {
        var read = Week.Select(day => Training(day.Name, day.Page)).ToList();

        var days = ImportTableEvidence.Enrich(new AiProgram("Min-Max", read), Pages()).Days!;

        Assert.Equal(["Upper", "Lower", "Rest Day", "Push", "Pull", "Arms", "Rest Day"], days.Select(day => day.DayName));
    }

    [Fact]
    public void More_rest_days_than_printed_bands_keep_the_read_order()
    {
        var read = new List<AiDay>
        {
            Training("Upper", 46), Rest(46), Training("Lower", 47), Rest(47), Training("Push", 48), Training("Pull", 49),
            Training("Arms", 50), Rest(50)
        };

        var days = ImportTableEvidence.Enrich(new AiProgram("Min-Max", read), Pages()).Days!;

        Assert.Equal(read.Select(day => day.DayName), days.Select(day => day.DayName));
    }
}
