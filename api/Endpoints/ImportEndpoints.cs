using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class ImportEndpoints
{
    public record AcceptImportInput(string? TimeZone, bool AcknowledgeUnspecified = false);

    public static void MapImports(this WebApplication app)
    {
        // Cloud Tasks reaches the private worker through Cloud Run IAM. An optional second bearer
        // secret can be configured for defense in depth; the public API has Enabled=false, so the
        // route is inert there.
        app.MapPost("/internal/import-tasks", async (HttpRequest request, CloudTasksImportJobDispatcher.ImportTask input,
            AppDb db, IConfiguration config, ImportService imports, CancellationToken ct) =>
        {
            var expected = config["ImportWorker:Secret"]?.Trim() ?? "";
            var presented = request.Headers["X-Workout-Worker-Secret"].ToString();
            Validation.Require(config.GetValue("ImportWorker:Enabled", false) &&
                (string.IsNullOrWhiteSpace(expected) || CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(presented))),
                "Worker task is not authorized.", 401);
            var previous = db.CurrentUser; db.CurrentUser = input.UserId;
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromMinutes(25));
            try { return await imports.Extract(input.ImportId, [], "", timeout.Token, input.ExpectedChunk); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            { throw new DomainException("The extraction chunk exceeded its worker time budget and will be retried.", 503); }
            finally { db.CurrentUser = previous; }
        }).DisableAntiforgery();

        // Cloud Scheduler invokes this endpoint hourly with Cloud Run IAM. ImportWorker:Enabled
        // is false on the public API, so exposing the same route there remains a safe no-op error;
        // only the private worker accepts maintenance traffic.
        app.MapPost("/internal/import-maintenance", async (IConfiguration config, ImportService imports, CancellationToken ct) =>
        {
            Validation.Require(config.GetValue("ImportWorker:Enabled", false), "Worker maintenance is disabled.", 404);
            await imports.CleanupExpired(ct);
            return Results.Ok(new { recovered = await imports.RecoverUndispatched(ct) });
        }).DisableAntiforgery();

        app.MapGet("/api/imports", async (ImportService imports, CancellationToken ct) => await imports.List(ct));
        app.MapGet("/api/imports/{id:guid}", async (Guid id, ImportService imports, CancellationToken ct) => await imports.Get(id, ct));

        app.MapPost("/api/imports/upload/init", async (ImportUploadInput input, ImportService imports, CancellationToken ct)
            => await imports.InitiateUpload(input.FileName, input.Size, ct));
        app.MapPut("/api/imports/upload/{id:guid}", async (Guid id, HttpRequest request, ImportService imports, CancellationToken ct) =>
        {
            Validation.Require(long.TryParse(request.Headers["Upload-Offset"], out var offset) && offset >= 0,
                "Upload-Offset is required for a resumable upload.", 400);
            using var stream = new MemoryStream();
            await request.Body.CopyToAsync(stream, ct);
            Validation.Require(stream.Length <= ImportService.UploadChunkBytes, "That upload chunk is too large.", 413);
            return await imports.AppendUpload(id, offset, stream.ToArray(), ct);
        }).DisableAntiforgery();
        app.MapPost("/api/imports/upload/{id:guid}/complete", async (Guid id, ImportService imports, CancellationToken ct)
            => await imports.CompleteUpload(id, ct));
        app.MapDelete("/api/imports/upload/{id:guid}", async (Guid id, ImportService imports, CancellationToken ct)
            => { await imports.CancelUpload(id, ct); return Results.NoContent(); });

        app.MapPost("/api/imports", async (HttpRequest request, ImportService imports, CancellationToken ct) =>
        {
            Validation.Require(request.HasFormContentType, "Upload the PDF as a form file.");
            var form = await request.ReadFormAsync(ct);
            var file = form.Files.GetFile("file");
            Validation.Require(file != null, "Choose a PDF to import.");
            Validation.Require(file!.Length <= PdfInspection.MaxBytes, "That PDF is larger than 150 MiB.", 413);
            using var stream = new MemoryStream();
            await file.CopyToAsync(stream, ct);
            // The bytes live only for this request: they are inspected, sent, and dropped.
            // Keep the committed import alive if the browser disconnects while the outline is
            // being read; the persisted worker takes over once detailed extraction is staged.
            return await imports.Create(stream.ToArray(), file.FileName, CancellationToken.None);
        }).RequireRateLimiting("ai").DisableAntiforgery();

        app.MapPost("/api/imports/{id:guid}/extract", async (Guid id, HttpRequest request, ImportService imports, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) return await imports.Extract(id, [], "", ct);
            var form = await request.ReadFormAsync(ct);
            var file = form.Files.GetFile("file");
            if (file == null) return await imports.Extract(id, [], "", ct);
            Validation.Require(file.Length <= PdfInspection.MaxBytes, "That PDF is larger than 150 MiB.", 413);
            using var stream = new MemoryStream();
            await file.CopyToAsync(stream, ct);
            return await imports.Extract(id, stream.ToArray(), file.FileName, ct);
        }).RequireRateLimiting("ai-extract").DisableAntiforgery();
        app.MapPost("/api/imports/{id:guid}/retry", async (Guid id, ImportService imports, CancellationToken ct)
            => await imports.Retry(id, ct)).RequireRateLimiting("ai-extract").DisableAntiforgery();

        app.MapPut("/api/imports/{id:guid}", async (Guid id, JsonElement payload, ImportService imports, CancellationToken ct) =>
        {
            if (payload.TryGetProperty("workouts", out _))
                return await imports.Edit(id, Json.Read<ImportDraft>(payload.GetRawText()), ct);
            return await imports.EditMetadata(id, Json.Read<ImportMetadata>(payload.GetRawText()), ct);
        });
        app.MapPut("/api/imports/{id:guid}/days/{lineId:guid}", async (Guid id, Guid lineId, DraftWorkout day, ImportService imports, CancellationToken ct)
            => await imports.EditDay(id, lineId, day, ct));
        app.MapPost("/api/imports/{id:guid}/rematch", async (Guid id, ImportService imports, CancellationToken ct) => await imports.Rematch(id, ct));
        app.MapPost("/api/imports/{id:guid}/alternative", async (Guid id, ImportAlternativeInput input, ImportService imports, CancellationToken ct)
            => await imports.SelectAlternative(id, input.AlternativeId, ct));
        app.MapPost("/api/imports/{id:guid}/accept", async (Guid id, HttpRequest request, ImportService imports, CancellationToken ct) =>
        {
            string? timeZone = null;
            var acknowledgeUnspecified = false;
            if (request.HasJsonContentType())
            {
                var input = await request.ReadFromJsonAsync<AcceptImportInput>(ct);
                timeZone = input?.TimeZone;
                acknowledgeUnspecified = input?.AcknowledgeUnspecified ?? false;
            }
            return await imports.Accept(id, timeZone, acknowledgeUnspecified, ct);
        });
        app.MapPost("/api/imports/{id:guid}/discard", async (Guid id, ImportService imports, CancellationToken ct) =>
        { await imports.Discard(id, ct); return Results.NoContent(); });
    }
}

public record ImportUploadInput(string FileName, long Size);
public record ImportAlternativeInput(string AlternativeId);
