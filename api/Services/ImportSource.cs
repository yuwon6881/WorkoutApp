using System.Security.Cryptography;
using System.Text;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// One page of text the browser read out of the PDF. Pages with no selectable text are simply
/// absent: this app imports written programs, and a page whose content exists only as an image
/// carries nothing that can be transcribed faithfully.
public record ImportPageText(int Page, string Text);

/// What a browser submits in place of the PDF. The document itself never leaves the device.
public record ImportSourceInput(string FileName, int PageCount, List<ImportPageText> Pages, List<ImportPageLink>? Links = null);

public record PdfPageCoverage(int Page, bool HasText, int CharacterCount);

/// Validation, bounding, and slicing for client-extracted page text. Everything the import
/// pipeline used to learn by parsing PDF bytes is derived here instead, from text alone.
public static class ImportSourceText
{
    public const int MaxPages = 1000;
    public const int MaxPageChars = 40_000;
    public const int MaxTotalChars = 2_000_000;
    /// A document small enough to read whole gives the outline pass better phase boundaries than
    /// a per-page preview does; anything larger is summarised page by page instead.
    public const int WholeDocumentOutlineChars = 60_000;
    public const int OutlinePagePreviewChars = 600;
    public const int MaxOutlineChars = 200_000;
    public const int MaxChunkChars = 400_000;

    /// Accepts the submitted text or explains exactly what is wrong with it. Empty pages are
    /// dropped rather than rejected, because a 100-page book with 10 program pages is the normal
    /// case this importer is built for.
    public static List<ImportPageText> Normalize(ImportSourceInput input)
    {
        Validation.Name(input.FileName, "File name", 200);
        Validation.Require(input.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), "Choose a PDF file.");
        Validation.Require(input.PageCount is > 0 and <= MaxPages,
            $"That PDF has about {input.PageCount} pages; the importer accepts up to {MaxPages}.", 413);
        Validation.Require(input.Pages is not null, "That PDF produced no readable text.", 422);
        var pages = new List<ImportPageText>(input.Pages!.Count);
        var seen = new HashSet<int>();
        var total = 0;
        foreach (var page in input.Pages.OrderBy(page => page.Page))
        {
            Validation.Require(page.Page is > 0 && page.Page <= input.PageCount, "A submitted page number is outside this PDF.", 422);
            Validation.Require(seen.Add(page.Page), "The same page was submitted twice.", 422);
            var text = Collapse(page.Text);
            if (text.Length == 0) continue;
            if (text.Length > MaxPageChars) text = text[..MaxPageChars];
            total += text.Length;
            Validation.Require(total <= MaxTotalChars, "That PDF holds more text than the importer supports. Split it into smaller files.", 413);
            pages.Add(new ImportPageText(page.Page, text));
        }
        Validation.Require(pages.Count > 0,
            "No selectable text was found in that PDF. A scanned document has to be re-saved as a text PDF before it can be imported.", 422);
        return pages;
    }

    /// The same text always produces the same hash, so re-submitting a PDF resumes its import
    /// rather than starting a second one. Extraction is deterministic for a given document.
    public static string Hash(IReadOnlyList<ImportPageText> pages)
    {
        var builder = new StringBuilder();
        foreach (var page in pages) builder.Append(page.Page).Append('').Append(page.Text).Append('');
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString())));
    }

    public static List<PdfPageCoverage> Coverage(IReadOnlyList<ImportPageText> pages, int pageCount)
    {
        var byPage = pages.ToDictionary(page => page.Page, page => page.Text.Length);
        return Enumerable.Range(1, pageCount)
            .Select(page => new PdfPageCoverage(page, byPage.ContainsKey(page), byPage.GetValueOrDefault(page)))
            .ToList();
    }

    /// What the outline pass reads. A large book is reduced to the opening lines of each page so
    /// the model can locate the training schedule without being billed for the whole volume.
    public static string Outline(IReadOnlyList<ImportPageText> pages)
    {
        var total = pages.Sum(page => page.Text.Length);
        var builder = new StringBuilder();
        foreach (var page in pages)
        {
            var text = total <= WholeDocumentOutlineChars || page.Text.Length <= OutlinePagePreviewChars
                ? page.Text
                : page.Text[..OutlinePagePreviewChars] + " …";
            builder.Append("=== PAGE ").Append(page.Page).Append(" ===\n").Append(text).Append("\n\n");
            if (builder.Length >= MaxOutlineChars) break;
        }
        var result = builder.ToString().TrimEnd();
        return result.Length > MaxOutlineChars ? result[..MaxOutlineChars] : result;
    }

    /// The full text of one chunk's pages. This is the only place a page's complete content is
    /// spent on tokens, and only for the pages the outline identified as program pages.
    public static string Slice(IReadOnlyList<ImportPageText> pages, int pageFrom, int pageTo)
    {
        var builder = new StringBuilder();
        foreach (var page in pages.Where(page => page.Page >= pageFrom && page.Page <= pageTo))
        {
            builder.Append("=== PAGE ").Append(page.Page).Append(" ===\n").Append(page.Text).Append("\n\n");
            if (builder.Length >= MaxChunkChars) break;
        }
        var result = builder.ToString().TrimEnd();
        return result.Length > MaxChunkChars ? result[..MaxChunkChars] : result;
    }

    /// Normalizes whitespace without touching the line structure the browser reconstructed from
    /// the page's word positions: those line breaks are what keep a training table readable.
    private static string Collapse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var builder = new StringBuilder(text.Length);
        foreach (var line in text.ReplaceLineEndings("\n").Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0) continue;
            builder.Append(trimmed).Append('\n');
        }
        return builder.ToString().Trim();
    }
}
