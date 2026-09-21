using System.Text.Json;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class ProgramDraftEndpoints
{
    private const int MaxRequestBytes = 1_100_000;

    public static void MapProgramDrafts(this WebApplication app)
    {
        app.MapGet("/api/program-drafts", async (ProgramDraftService drafts, CancellationToken ct)
            => await drafts.List(ct));
        app.MapPost("/api/program-drafts", async (HttpRequest request, ProgramDraftService drafts, CancellationToken ct)
            => await drafts.Create(await ReadJson<ProgramDraftCreateInput>(request, ct), ct));
        app.MapGet("/api/program-drafts/{id:guid}", async (Guid id, ProgramDraftService drafts, CancellationToken ct)
            => await drafts.Get(id, ct));
        app.MapPut("/api/program-drafts/{id:guid}", async (Guid id, HttpRequest request, ProgramDraftService drafts, CancellationToken ct)
            => await drafts.Update(id, await ReadJson<ProgramDraftUpdateInput>(request, ct), ct));
        app.MapDelete("/api/program-drafts/{id:guid}", async (Guid id, ProgramDraftService drafts, CancellationToken ct) =>
        {
            await drafts.Delete(id, ct);
            return Results.NoContent();
        });
        app.MapPost("/api/program-drafts/{id:guid}/create-program", async (Guid id, HttpRequest request, ProgramDraftService drafts, CancellationToken ct)
            => await drafts.CreateProgram(id, await ReadJson<ProgramDraftCreateProgramInput>(request, ct), ct));
    }

    private static async Task<T> ReadJson<T>(HttpRequest request, CancellationToken ct)
    {
        Validation.Require(request.ContentLength is null or <= MaxRequestBytes,
            "That program draft request is larger than the 1 MB limit.", 413);
        using var body = new MemoryStream();
        var buffer = new byte[16 * 1024];
        int read;
        while ((read = await request.Body.ReadAsync(buffer, ct)) > 0)
        {
            Validation.Require(body.Length + read <= MaxRequestBytes,
                "That program draft request is larger than the 1 MB limit.", 413);
            await body.WriteAsync(buffer.AsMemory(0, read), ct);
        }

        try
        {
            return JsonSerializer.Deserialize<T>(body.GetBuffer().AsSpan(0, checked((int)body.Length)), Json.Options)
                ?? throw new DomainException("Program draft data is required.");
        }
        catch (JsonException)
        {
            throw new DomainException("Program draft data could not be read.");
        }
    }
}
