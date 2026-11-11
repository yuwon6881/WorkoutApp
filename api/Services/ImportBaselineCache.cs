using System.Collections.Concurrent;
using System.Text.Json;

namespace Workout.Api.Services;

/// The default-extraction baseline a review compares against never changes until it is restored,
/// yet every save parsed and normalized it again. Entries are keyed by the baseline's own content,
/// so a restore or an edit can never be served a stale copy, and callers treat them as read-only.
internal static class ImportBaselineCache
{
    private const int Capacity = 8;
    private static readonly ConcurrentDictionary<(Guid Id, int Hash, int Length), ImportDraft> Entries = new();
    private static readonly ConcurrentQueue<(Guid Id, int Hash, int Length)> Order = new();

    /// The normalized draft in this JSON, or null when there is none to read.
    public static ImportDraft? Read(Guid importId, string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        var key = (importId, json.GetHashCode(), json.Length);
        if (Entries.TryGetValue(key, out var cached)) return cached;
        ImportDraft draft;
        try { draft = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(json)); }
        catch (JsonException) { return null; }
        if (Entries.TryAdd(key, draft))
        {
            Order.Enqueue(key);
            while (Entries.Count > Capacity && Order.TryDequeue(out var oldest)) Entries.TryRemove(oldest, out _);
        }
        return draft;
    }
}
