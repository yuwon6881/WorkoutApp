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

    /// The Full Body edition's notes say "this Full Body version of the program"; a phrase inside a
    /// sentence is not the book's name.
    [Fact]
    public void A_phrase_lifted_from_a_sentence_gives_way_to_the_running_footer()
    {
        var pages = Pages().Prepend(new ImportPageText(1,
            "Note that for the first 2 weeks of this Full Body version of the program, most sets in the program are lighter.")).ToList();

        Assert.Equal("The Pure Bodybuilding Program", ImportProgramTitle.Grounded("Full Body Version", pages));
    }

    /// Pure Bodybuilding Full Body came back as "Full Body": the stem of every "Full Body #3" it
    /// prints names a session, not the book.
    [Fact]
    public void A_title_that_is_a_day_labels_stem_gives_way_to_the_running_footer()
    {
        var pages = Enumerable.Range(6, 6).Select(page => new ImportPageText(page,
            $"DAY LABEL: Full Body #{page - 5}\nExercise | WORKING SETS | Reps\nCable Crunch | 3 | 10-12\nThe Pure Bodybuilding Program | {page - 5}")).ToList();

        Assert.Equal("The Pure Bodybuilding Program", ImportProgramTitle.Grounded("Full Body", pages));
    }

    /// BTS Beginner heads every table "Tracking Load and Reps" as often as it prints its footer.
    [Fact]
    public void A_line_printed_as_often_as_the_footer_but_without_a_page_number_is_not_the_title()
    {
        var pages = Enumerable.Range(4, 6).Select(page => new ImportPageText(page,
            $"Tracking Load and Reps\nDAY LABEL: Upper\nExercise | Working Sets | Reps\nSquat | 2 | 8-10\nThe Bodybuilding Transformation System | {page}")).ToList();

        Assert.Equal("The Bodybuilding Transformation System", ImportProgramTitle.RunningTitle(pages));
        Assert.Equal("The Bodybuilding Transformation System", ImportProgramTitle.Grounded("Tracking Load and Reps", pages));
    }

    /// Chest Hypertrophy's footer is "JEFF nIPPARd’S | Chest hypertrophy program | 6" in small caps,
    /// and every page also ends on a weekly tally, "WEEKLY SET VOLUME | 21", whose number does not
    /// follow the page.
    [Fact]
    public void A_footer_whose_number_follows_the_page_outranks_a_repeated_tally()
    {
        var pages = Enumerable.Range(6, 8).Select(page => new ImportPageText(page,
            $"DAY LABEL: DAY 1\nEXERCISE | SETS | REPS\nBench press | 3 | 6\nWEEKLY SET VOLUME | {20 + page % 2}\nJEFF nIPPARd’S | Chest hypertrophy program | {page}")).ToList();

        Assert.Equal("JEFF Nippard’s - Chest hypertrophy program", ImportProgramTitle.RunningTitle(pages));
    }
}
