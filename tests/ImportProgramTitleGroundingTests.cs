using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The Pure Bodybuilding Program was named "Hypertrophy Handbook Program": its notes keep
/// sending readers to The Hypertrophy Handbook, while its own name is the footer of every page.
public sealed class ImportProgramTitleGroundingTests
{
    private static List<ImportPageText> Pages() =>
    [
        new(2, "IMPORTANT PROGRAM NOTES\nSee The Hypertrophy Handbook for a full explanation of RPE."),
        .. Enumerable.Range(6, 6).Select(page => new ImportPageText(page,
            $"BLOCK 1: 5-WEEK BUILD PHASE\nDAY LABEL: Upper #1\nExercise | Warm-up Sets | WORKING SETS | Reps\nCable Crunch | 1 | 3 | 10-12\nThe Pure Bodybuilding Program | {page - 5}"))
    ];

    [Fact]
    public void A_title_the_document_never_prints_gives_way_to_its_running_footer()
    {
        Assert.Equal("The Pure Bodybuilding Program", ImportProgramTitle.Grounded("Hypertrophy Handbook Program", Pages()));
    }

    [Theory]
    [InlineData("The Pure Bodybuilding Program")]
    [InlineData("Pure Bodybuilding")]
    public void A_title_the_document_prints_is_kept(string title)
    {
        Assert.Equal(title, ImportProgramTitle.Grounded(title, Pages()));
    }

    [Fact]
    public void A_document_without_a_running_title_keeps_the_outline_title()
    {
        var pages = Enumerable.Range(1, 6).Select(page => new ImportPageText(page, $"WEEK {page}\nSquat | 3 | 5")).ToList();

        Assert.Equal("Strength Block", ImportProgramTitle.Grounded("Strength Block", pages));
    }
}
