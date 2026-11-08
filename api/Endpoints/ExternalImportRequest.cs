using System.Text;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

internal static class ExternalImportRequest
{
    public const int MaxBytes = ExternalImportEnvelope.MaxBytes;

    public static async Task<string> Read(HttpRequest request, CancellationToken ct)
    {
        var mediaType = request.ContentType?.Split(';', 2)[0].Trim();
        Validation.Require(string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase),
            "Choose a JSON file.", 415);
        Validation.Require(request.ContentLength is null or <= MaxBytes, "Use a file no larger than 8 MiB; split the program if necessary.", 413);
        using var data = new MemoryStream();
        var buffer = new byte[64 * 1024];
        while (true)
        {
            var count = await request.Body.ReadAsync(buffer.AsMemory(0, Math.Min(buffer.Length, MaxBytes + 1 - (int)data.Length)), ct);
            if (count == 0) break;
            data.Write(buffer, 0, count);
            Validation.Require(data.Length <= MaxBytes, "Use a file no larger than 8 MiB; split the program if necessary.", 413);
        }
        try
        {
            var bytes = data.GetBuffer();
            var prefix = data.Length >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf ? 3 : 0;
            return new UTF8Encoding(false, true).GetString(bytes, prefix, (int)data.Length - prefix);
        }
        catch (DecoderFallbackException) { throw new DomainException("Save the file as UTF-8 JSON and upload it again.", 400); }
    }
}
