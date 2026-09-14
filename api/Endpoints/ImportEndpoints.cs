using System.Text.Json;
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

        app.MapPost("/api/imports/{id:guid}/extract", async (Guid id, HttpRequest request, ImportService imports, CancellationToken ct) =>
        {
            Validation.Require(request.HasFormContentType, "Upload the same PDF as a form file.");
            var form = await request.ReadFormAsync(ct);
            var file = form.Files.GetFile("file");
            Validation.Require(file != null, "Choose the same PDF to continue this import.");
            Validation.Require(file!.Length <= PdfInspection.MaxBytes, "That PDF is larger than 20 MB.", 413);
            using var stream = new MemoryStream();
            await file.CopyToAsync(stream, ct);
            return await imports.Extract(id, stream.ToArray(), file.FileName, ct);
        }).RequireRateLimiting("ai-extract").DisableAntiforgery();

        app.MapPut("/api/imports/{id:guid}", async (Guid id, JsonElement payload, ImportService imports, CancellationToken ct) =>
        {
            if (payload.TryGetProperty("workouts", out _))
                return await imports.Edit(id, Json.Read<ImportDraft>(payload.GetRawText()), ct);
            return await imports.EditMetadata(id, Json.Read<ImportMetadata>(payload.GetRawText()), ct);
        });
        app.MapPut("/api/imports/{id:guid}/days/{lineId:guid}", async (Guid id, Guid lineId, DraftWorkout day, ImportService imports, CancellationToken ct)
            => await imports.EditDay(id, lineId, day, ct));
        app.MapPost("/api/imports/{id:guid}/rematch", async (Guid id, ImportService imports, CancellationToken ct) => await imports.Rematch(id, ct));
        app.MapPost("/api/imports/{id:guid}/accept", async (Guid id, ImportService imports, CancellationToken ct) => await imports.Accept(id, ct));
        app.MapPost("/api/imports/{id:guid}/discard", async (Guid id, ImportService imports, CancellationToken ct) =>
        { await imports.Discard(id, ct); return Results.NoContent(); });
    }
}
