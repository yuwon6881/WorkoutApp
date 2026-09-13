using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class ImportEndpoints
{
    public static void MapImports(this WebApplication app)
    {
        app.MapGet("/api/imports", async (ImportService imports, CancellationToken ct) => await imports.List(ct));
        app.MapGet("/api/imports/{id:guid}", async (Guid id, ImportService imports, CancellationToken ct) => await imports.Get(id, ct));

        app.MapPost("/api/imports", async (HttpRequest request, ImportService imports, CancellationToken ct) =>
        {
            Validation.Require(request.HasFormContentType, "Upload the PDF as a form file.");
            var form = await request.ReadFormAsync(ct);
            var file = form.Files.GetFile("file");
            Validation.Require(file != null, "Choose a PDF to import.");
            Validation.Require(file!.Length <= PdfInspection.MaxBytes, "That PDF is larger than 20 MB.", 413);
            using var stream = new MemoryStream();
            await file.CopyToAsync(stream, ct);
            // The bytes live only for this request: they are inspected, sent, and dropped.
            return await imports.Create(stream.ToArray(), file.FileName, ct);
        }).RequireRateLimiting("ai").DisableAntiforgery();

        app.MapPut("/api/imports/{id:guid}", async (Guid id, ImportDraft draft, ImportService imports, CancellationToken ct) => await imports.Edit(id, draft, ct));
        app.MapPost("/api/imports/{id:guid}/rematch", async (Guid id, ImportService imports, CancellationToken ct) => await imports.Rematch(id, ct));
        app.MapPost("/api/imports/{id:guid}/accept", async (Guid id, ImportService imports, CancellationToken ct) => await imports.Accept(id, ct));
        app.MapPost("/api/imports/{id:guid}/discard", async (Guid id, ImportService imports, CancellationToken ct) =>
        { await imports.Discard(id, ct); return Results.NoContent(); });
    }
}
