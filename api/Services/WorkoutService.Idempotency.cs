using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class WorkoutService
{
    private async Task<SessionView?> ReplayWorkoutMutation(Guid sessionId, Guid? mutationId, string operation,
        string requestHash, CancellationToken ct)
    {
        if (mutationId is not { } id) return null;
        var receipt = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(row => row.Id == id, ct);
        if (receipt is null) return null;

        Validation.Require(receipt.Operation == operation && receipt.ResourceId == sessionId &&
            string.Equals(receipt.RequestHash, requestHash, StringComparison.Ordinal),
            "This change was already saved with different details.", 409);
        return await Get(sessionId, ct);
    }

    private async Task RecordWorkoutMutation(Guid? mutationId, Guid sessionId, string operation,
        string requestHash, CancellationToken ct)
    {
        if (mutationId is not { } id) return;
        Validation.Require(id != Guid.Empty, "The mutation identity is invalid.");
        Validation.Require(!await db.Receipts.AnyAsync(row => row.Id == id, ct), "This change was already saved.", 409);
        db.Receipts.Add(new MutationReceipt
        {
            UserId = db.CurrentUser!.Value,
            Id = id,
            Operation = operation,
            ResourceId = sessionId,
            RequestHash = requestHash
        });
    }

    private static string Fingerprint<T>(T request)
        => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(request)));

    private static string Fingerprint(JsonElement request)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer)) WriteCanonical(request, writer);
        return Convert.ToHexString(SHA256.HashData(buffer.ToArray()));
    }

    private static void WriteCanonical(JsonElement value, Utf8JsonWriter writer)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject().OrderBy(property => property.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    WriteCanonical(property.Value, writer);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in value.EnumerateArray()) WriteCanonical(item, writer);
                writer.WriteEndArray();
                break;
            default:
                value.WriteTo(writer);
                break;
        }
    }
}
