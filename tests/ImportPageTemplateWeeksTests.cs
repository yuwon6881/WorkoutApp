using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportPageTemplateWeeksTests
{
    [Fact]
    public void Complete_weekly_pages_restore_all_weeks_when_outline_stops_early()
    {
        var pages = Enumerable.Range(8, 8).Select(page => new ImportPageText(page,
            $"BLOCK {(page < 12 ? 1 : 2)}\nDAY LABEL: DAY 1\nDAY LABEL: DAY 2\nDAY LABEL: DAY 3\n"))
            .ToList();
        var outline = new List<ImportChunk>
        {
            new("Shoulder block 1", "Block 1", null, 1, 4, 8, 11, 12),
            new("Shoulder block 2", "Block 2", null, 5, 6, 12, 13, 6)
        };

        var chunks = ImportPageTemplateWeeks.Reconcile(outline, pages);

        Assert.Equal(8, chunks.Count);
        Assert.Equal(Enumerable.Range(1, 8), chunks.Select(chunk => chunk.WeekFrom));
        Assert.All(chunks, chunk => Assert.Equal(chunk.WeekFrom, chunk.WeekTo));
        Assert.Equal(Enumerable.Range(8, 8), chunks.Select(chunk => chunk.PageFrom));
        Assert.All(chunks, chunk => Assert.Equal(3, chunk.DayCount));
        Assert.Equal("Block 2", chunks[4].Block);
    }

    [Fact]
    public void Incomplete_or_ambiguous_pages_do_not_invent_week_boundaries()
    {
        var pages = Enumerable.Range(8, 8).Select(page => new ImportPageText(page,
            $"BLOCK {(page < 12 ? 1 : 2)}\nDAY LABEL: DAY 1\nDAY LABEL: DAY 2\n"
            + (page == 12 ? "" : "DAY LABEL: DAY 3\n"))).ToList();
        var outline = new List<ImportChunk> { new("Section", null, null, 1, 8, 8, 15, 24) };

        Assert.Same(outline, ImportPageTemplateWeeks.Reconcile(outline, pages));
    }
}
