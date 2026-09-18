using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class ImportEndpoints
{
    public record AcceptImportInput(string? TimeZone);

    /// The browser sends the text it read from the PDF, not the PDF. Even a large book's text
    /// layer compresses to a small request, so the body is bounded here twice: once against the
    /// bytes actually received and once against what they expand to, so a crafted archive cannot
    /// turn a small upload into an unbounded allocation.
    private const int MaxCompressedBytes = 8 * 1024 * 1024;
    private const int MaxDecompressedBytes = 16 * 1024 * 1024;

    public static void MapImports(this WebApplication app)
    {
        // Cloud Scheduler invokes this hourly to run the retention sweep that keeps imports,
        // sessions, receipts, and usage rows bounded. This service is reachable without Cloud Run
        // IAM, so the route stays absent unless a secret is configured and presented exactly.
        app.MapPost("/internal/import-maintenance", async (HttpRequest request, IConfiguration config, ImportService imports, CancellationToken ct) =>
        {
            var expected = config["Maintenance:Secret"]?.Trim() ?? "";
            var presented = request.Headers["X-Workout-Maintenance-Secret"].ToString();
            Validation.Require(!string.IsNullOrWhiteSpace(expected) &&
                CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(presented)),
                "Maintenance is not available.", 404);
            await imports.CleanupExpired(ct);
            return Results.Ok(new { swept = true });
        }).DisableAntiforgery();

        app.MapGet("/api/imports", async (ImportService imports, CancellationToken ct) => await imports.List(ct));
        app.MapGet("/api/imports/{id:guid}", async (Guid id, ImportService imports, CancellationToken ct) => await imports.Get(id, ct));

        app.MapPost("/api/imports", async (HttpRequest request, ImportService imports, CancellationToken ct) =>
        {
            var input = await ReadSource(request, ct);
            // Once the text has been accepted, let the outline pass finish even if the browser
            // closes: the read is billed either way and its result belongs to the import.
            return await imports.Create(input, CancellationToken.None);
        }).RequireRateLimiting("ai").DisableAntiforgery();

        // A read is billed the moment it starts, so closing the tab must not throw it away. The
        // runner owns the pass and this response only acknowledges the current persisted state;
        // the browser polls the GET route while the model reads happen outside the proxy request.
        app.MapPost("/api/imports/{id:guid}/extract", async (Guid id, AppDb db, ImportRunner runner, ImportService imports) =>
        {
            Validation.Require(db.CurrentUser is not null, "Sign in to load your training.", 401);
            runner.Start(id, db.CurrentUser!.Value);
            return await imports.Get(id, CancellationToken.None);
        }).RequireRateLimiting("ai-extract").DisableAntiforgery();
        app.MapPost("/api/imports/{id:guid}/retry", async (Guid id, AppDb db, ImportRunner runner, ImportService imports) =>
        {
            Validation.Require(db.CurrentUser is not null, "Sign in to load your training.", 401);
            runner.Start(id, db.CurrentUser!.Value);
            return await imports.Get(id, CancellationToken.None);
        }).RequireRateLimiting("ai-extract").DisableAntiforgery();

        app.MapPut("/api/imports/{id:guid}", async (Guid id, JsonElement payload, ImportService imports, CancellationToken ct) =>
        {
            if (payload.TryGetProperty("workouts", out _))
                return await imports.Edit(id, Json.Read<ImportDraft>(payload.GetRawText()), ct);
            return await imports.EditMetadata(id, Json.Read<ImportMetadata>(payload.GetRawText()), ct);
        });
        app.MapPut("/api/imports/{id:guid}/days/{lineId:guid}", async (Guid id, Guid lineId, DraftWorkout day, ImportService imports, CancellationToken ct)
            => await imports.EditDay(id, lineId, day, ct));
        app.MapPost("/api/imports/{id:guid}/alternative", async (Guid id, ImportAlternativeInput input, ImportService imports, CancellationToken ct)
            => await imports.SelectAlternative(id, input.AlternativeId, ct));
        app.MapPost("/api/imports/{id:guid}/accept", async (Guid id, HttpRequest request, ImportService imports, CancellationToken ct) =>
        {
            string? timeZone = null;
            if (request.HasJsonContentType())
            {
                var input = await request.ReadFromJsonAsync<AcceptImportInput>(ct);
                timeZone = input?.TimeZone;
            }
            return await imports.Accept(id, timeZone, ct);
        });
        app.MapPost("/api/imports/{id:guid}/discard", async (Guid id, ImportService imports, CancellationToken ct) =>
        { await imports.Discard(id, ct); return Results.NoContent(); });
    }

    /// Reads the submitted page text, transparently decompressing a gzip body. Compression is what
    /// keeps a long document inside the hosting proxy's request limit, so it is a supported
    /// encoding here rather than something the browser has to work around.
    private static async Task<ImportSourceInput> ReadSource(HttpRequest request, CancellationToken ct)
    {
        var gzip = request.Headers.ContentEncoding.Any(value => value is not null && value.Contains("gzip", StringComparison.OrdinalIgnoreCase));
        using var received = new MemoryStream();
        await request.Body.CopyToAsync(received, ct);
        Validation.Require(received.Length > 0, "Choose a PDF to import.");
        Validation.Require(received.Length <= MaxCompressedBytes, "That request is larger than the importer accepts.", 413);
        received.Position = 0;

        Stream payload = received;
        MemoryStream? expanded = null;
        if (gzip)
        {
            expanded = new MemoryStream();
            await using var decompressor = new GZipStream(received, CompressionMode.Decompress);
            var buffer = new byte[64 * 1024];
            int read;
            while ((read = await decompressor.ReadAsync(buffer, ct)) > 0)
            {
                expanded.Write(buffer, 0, read);
                Validation.Require(expanded.Length <= MaxDecompressedBytes, "That PDF holds more text than the importer supports. Split it into smaller files.", 413);
            }
            expanded.Position = 0;
            payload = expanded;
        }

        try
        {
            var input = await JsonSerializer.DeserializeAsync<ImportSourceInput>(payload, Json.Options, ct);
            Validation.Require(input is not null, "That PDF produced no readable text.", 422);
            return input!;
        }
        catch (JsonException)
        {
            throw new DomainException("The extracted PDF text could not be read. Choose the PDF again.", 400);
        }
        finally { expanded?.Dispose(); }
    }
}

public record ImportAlternativeInput(string AlternativeId);
