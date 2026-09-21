using System.Text.Json;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class ProgramEditorEndpoints
{
    private const int MaxRequestBytes = 1_100_000;

    public static void MapProgramEditor(this WebApplication app)
    {
        app.MapPost("/api/programs/from-editor", async (HttpRequest request, ProgramEditorService editor, CancellationToken ct)
            => await editor.CreateProgram(await ReadJson<ProgramEditorCreateInput>(request, ct), ct));
    }

    private static async Task<T> ReadJson<T>(HttpRequest request, CancellationToken ct)
    {
        Validation.Require(request.ContentLength is null or <= MaxRequestBytes,
            "That program request is larger than the 1 MB limit.", 413);
        using var body = new MemoryStream();
        var buffer = new byte[16 * 1024];
        int read;
        while ((read = await request.Body.ReadAsync(buffer, ct)) > 0)
        {
            Validation.Require(body.Length + read <= MaxRequestBytes,
                "That program request is larger than the 1 MB limit.", 413);
            await body.WriteAsync(buffer.AsMemory(0, read), ct);
        }

        try
        {
            return JsonSerializer.Deserialize<T>(body.GetBuffer().AsSpan(0, checked((int)body.Length)), Json.Options)
                ?? throw new DomainException("Program data is required.");
        }
        catch (JsonException)
        {
            throw new DomainException("Program data could not be read.");
        }
    }
}
