using System.Net;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A program written as text does not stop being readable because the document also contains
/// photographs. The importer used to send the whole file as a visual input whenever any single
/// page lacked text, so a large illustrated PDF was refused for "having no readable text" even
/// though its program was sitting in the text layer.
public sealed class PdfTextPathTests
{
    private const string Outline = """
        {"programTitle":"Illustrated block","description":null,"chunks":[
          {"label":"Week 1","block":"Base","phase":"Strength","weekFrom":1,"weekTo":1,"pageFrom":1,"pageTo":1,"dayCount":1}]}
        """;

    private static Dictionary<string, string?> Configured => new()
    {
        ["OpenAi:ApiKey"] = "test-key",
        ["OpenAi:Model"] = "gpt-5.4-mini",
        ["ImportStorage:Directory"] = Path.Combine(Path.GetTempPath(), "workout-textpath-tests", Guid.NewGuid().ToString("N")),
        // Far below any real document, so the oversized branch runs without building a 50 MB file.
        ["OpenAi:MaxVisualInputBytes"] = "2048"
    };

    /// A first page carrying text, followed by pages carrying none — the shape of an illustrated
    /// program whose photographs have no text layer of their own.
    private static byte[] IllustratedPdf(int imagePages)
    {
        var builder = new PdfDocumentBuilder();
        var font = builder.AddStandard14Font(Standard14Font.Helvetica);
        var written = builder.AddPage(595, 842);
        written.AddText("Week 1 Day A Barbell bench press 3 x 8 @ RPE 8", 12, new PdfPoint(40, 700), font);
        for (var page = 0; page < imagePages; page++) builder.AddPage(595, 842);
        return builder.Build();
    }

    private static byte[] TextlessPdf()
    {
        var builder = new PdfDocumentBuilder();
        builder.AddPage(595, 842);
        return builder.Build();
    }

    [Fact]
    public void An_illustrated_program_is_recognised_as_part_text_and_part_image()
    {
        var coverage = PdfInspection.Coverage(IllustratedPdf(imagePages: 3));

        Assert.Contains(coverage, page => page.HasText);
        Assert.Contains(coverage, page => !page.HasText);
    }

    [Fact]
    public async Task An_oversized_illustrated_program_is_read_from_its_text_instead_of_being_refused()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var ai = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"status":"completed","output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(Outline)}}}]}]}""")
        });
        var imports = h.Imports(ai);

        var view = await imports.Create(IllustratedPdf(imagePages: 3), "illustrated.pdf", default);

        Assert.Equal("extract", view.Stage);
        Assert.Equal(ImportStatus.Pending, view.Status);
    }

    [Fact]
    public async Task A_document_with_no_text_at_all_still_asks_for_a_readable_copy()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        var imports = h.Imports(new StubHandler(_ => throw new HttpRequestException("never reached")));

        var failure = await Assert.ThrowsAsync<DomainException>(() => imports.Create(TextlessPdf(), "scan.pdf", default));

        Assert.Equal(422, failure.Status);
        Assert.Contains("no readable text", failure.Message);
    }

    /// A document the parser cannot open is not a document without text. Collapsing the two hid
    /// the real reason a readable program was rejected.
    [Fact]
    public void An_unopenable_document_reports_why_rather_than_claiming_it_has_no_text()
    {
        var damaged = System.Text.Encoding.ASCII.GetBytes("%PDF-1.7 this is not actually a pdf body");

        Assert.NotNull(PdfInspection.ReadFailure(damaged));
        Assert.Null(PdfInspection.ReadFailure(IllustratedPdf(imagePages: 1)));
    }
}
