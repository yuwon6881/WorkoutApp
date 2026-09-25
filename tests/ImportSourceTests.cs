using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The browser now reads the PDF and submits its text, so these bounds are the importer's front
/// door: everything the server used to learn by parsing PDF bytes is derived here instead.
public sealed class ImportSourceTests
{
    private static ImportSourceInput Input(params (int Page, string Text)[] pages)
        => new("program.pdf", pages.Length == 0 ? 1 : pages.Max(page => page.Page),
            pages.Select(page => new ImportPageText(page.Page, page.Text)).ToList());

    [Fact]
    public void Pages_without_text_are_dropped_rather_than_refused()
    {
        // The normal case for a commercial training book: a hundred pages of photography and ten
        // pages of program. Dropping the empty ones is what makes it importable at all.
        var pages = ImportSourceText.Normalize(Input((1, "   "), (2, "WEEK 1\nSquat 3x5"), (3, "")));
        var page = Assert.Single(pages);
        Assert.Equal(2, page.Page);
        Assert.Equal("WEEK 1\nSquat 3x5", page.Text);
    }

    [Fact]
    public void A_document_with_no_text_at_all_asks_for_a_readable_copy()
    {
        var failure = Assert.Throws<DomainException>(() => ImportSourceText.Normalize(Input((1, ""), (2, "  \n "))));
        Assert.Equal(422, failure.Status);
        Assert.Contains("scanned document", failure.Message);
    }

    [Fact]
    public void A_page_outside_the_document_and_a_repeated_page_are_both_refused()
    {
        var outside = new ImportSourceInput("program.pdf", 2, [new ImportPageText(5, "WEEK 1")]);
        Assert.Equal(422, Assert.Throws<DomainException>(() => ImportSourceText.Normalize(outside)).Status);

        var repeated = new ImportSourceInput("program.pdf", 2, [new ImportPageText(1, "a"), new ImportPageText(1, "b")]);
        Assert.Equal(422, Assert.Throws<DomainException>(() => ImportSourceText.Normalize(repeated)).Status);
    }

    [Fact]
    public void A_document_longer_than_the_page_limit_is_refused_before_any_model_call()
    {
        var input = new ImportSourceInput("program.pdf", ImportSourceText.MaxPages + 1, [new ImportPageText(1, "WEEK 1")]);
        Assert.Equal(413, Assert.Throws<DomainException>(() => ImportSourceText.Normalize(input)).Status);
    }

    [Fact]
    public void A_page_over_the_text_limit_is_refused_without_truncating_its_tail()
    {
        var input = Input((1, new string('x', ImportSourceText.MaxPageChars + 1)));

        var failure = Assert.Throws<DomainException>(() => ImportSourceText.Normalize(input));

        Assert.Equal(413, failure.Status);
        Assert.Contains("PDF page 1", failure.Message);
        Assert.Contains("Split", failure.Message);
    }

    [Fact]
    public void The_same_text_hashes_the_same_way_so_a_second_submission_resumes_the_first_import()
    {
        var first = ImportSourceText.Normalize(Input((1, "WEEK 1\nSquat 3x5")));
        var second = ImportSourceText.Normalize(Input((1, "WEEK 1\nSquat 3x5")));
        var different = ImportSourceText.Normalize(Input((1, "WEEK 2\nSquat 3x5")));
        Assert.Equal(ImportSourceText.Hash(first), ImportSourceText.Hash(second));
        Assert.NotEqual(ImportSourceText.Hash(first), ImportSourceText.Hash(different));
    }

    [Fact]
    public void Coverage_reports_every_page_including_the_ones_that_carried_no_text()
    {
        var coverage = ImportSourceText.Coverage(ImportSourceText.Normalize(Input((1, ""), (2, "WEEK 1"))), 3);
        Assert.Equal([1, 2, 3], coverage.Select(page => page.Page));
        Assert.Equal([false, true, false], coverage.Select(page => page.HasText));
        Assert.Equal(6, coverage[1].CharacterCount);
    }

    [Fact]
    public void A_short_document_is_outlined_whole_and_a_long_one_page_by_page()
    {
        var shortDocument = ImportSourceText.Normalize(Input((1, "WEEK 1\nSquat 3x5"), (2, "WEEK 2\nBench 3x5")));
        var outline = ImportSourceText.Outline(shortDocument);
        Assert.Contains("=== PAGE 1 ===", outline);
        Assert.Contains("Bench 3x5", outline);

        // A long page is reduced to its opening lines: enough to recognise what the page is,
        // without paying for a chapter of prose in the pass that only locates the program.
        var essay = new string('a', ImportSourceText.MaxPageChars);
        var longDocument = ImportSourceText.Normalize(Input((1, essay), (2, essay), (3, "WEEK 2")));
        var preview = ImportSourceText.Outline(longDocument);
        Assert.Contains("…", preview);
        Assert.Contains("WEEK 2", preview);
        Assert.True(preview.Length < essay.Length);
    }

    [Fact]
    public void An_outline_that_exceeds_its_bound_fails_instead_of_dropping_later_pages()
    {
        var pages = Enumerable.Range(1, 400).Select(number => new ImportPageText(number, new string('x', 700))).ToList();

        var failure = Assert.Throws<DomainException>(() => ImportSourceText.Outline(pages));

        Assert.Equal(413, failure.Status);
        Assert.Contains("Split", failure.Message);
    }

    [Fact]
    public void A_section_that_exceeds_its_bound_fails_instead_of_dropping_later_pages()
    {
        var pages = Enumerable.Range(1, 11).Select(number => new ImportPageText(number, new string('x', ImportSourceText.MaxPageChars))).ToList();

        var failure = Assert.Throws<DomainException>(() => ImportSourceText.Slice(pages, 1, 11));

        Assert.Equal(413, failure.Status);
        Assert.Contains("Split", failure.Message);
    }

    [Fact]
    public void A_chunk_reads_only_its_own_pages_in_full()
    {
        var pages = ImportSourceText.Normalize(Input((1, "Front matter"), (2, "WEEK 1"), (3, "WEEK 2"), (4, "Appendix")));
        var slice = ImportSourceText.Slice(pages, 2, 3);
        Assert.Contains("WEEK 1", slice);
        Assert.Contains("WEEK 2", slice);
        Assert.DoesNotContain("Front matter", slice);
        Assert.DoesNotContain("Appendix", slice);
        Assert.Equal("", ImportSourceText.Slice(pages, 9, 10));
    }

    [Fact]
    public void Normalization_keeps_unicode_line_separators_inside_a_table_cell()
    {
        const string separator = "\u2028";
        var source = "DAY LABEL: Arms\nExercise | Last-Set Intensity Technique | WORKING SETS | Reps | Rest\n"
            + $"Pressdown | Static Stretch{separator}(30 sec) | 2 | 12-15 | ~1-2 min";

        var normalized = Assert.Single(ImportSourceText.Normalize(Input((1, source))));

        Assert.Contains($"Static Stretch{separator}(30 sec) | 2 | 12-15 | ~1-2 min", normalized.Text);
        Assert.DoesNotContain("Static Stretch\n(30 sec)", normalized.Text);
    }
}
