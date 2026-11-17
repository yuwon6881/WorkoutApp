using System.Text.Json;
using System.Text.Json.Nodes;
using Workout.Api.Domain;

namespace Workout.Api.Services;

internal sealed record PrescriptionDelta(List<int> Removed, Dictionary<int, JsonObject> Patches, List<SetPrescription> Appended)
{
    public bool Changed => Removed.Count > 0 || Patches.Count > 0 || Appended.Count > 0;

    public static PrescriptionDelta Between(List<SetPrescription> before, List<SetPrescription> after)
    {
        var working = before.ToList();
        var removed = new List<int>();
        while (working.Count > after.Count)
        {
            var index = Enumerable.Range(0, working.Count).OrderByDescending(i => working.Where((_, at) => at != i)
                .Zip(after).Count(pair => pair.First == pair.Second)).ThenByDescending(i => i).First();
            removed.Add(index);
            working.RemoveAt(index);
        }
        var patches = new Dictionary<int, JsonObject>();
        for (var i = 0; i < Math.Min(working.Count, after.Count); i++)
        {
            var old = JsonSerializer.SerializeToNode(working[i], Json.Options)!.AsObject();
            var next = JsonSerializer.SerializeToNode(after[i], Json.Options)!.AsObject();
            // Only a set's type (a warm-up flag or a technique written in its notes) is structure.
            // Its reps, load and effort targets are read from the program and history each session,
            // so they are never carried, even beside a type change: another occurrence keeps its own.
            // The one exception is the effort a type itself sets (a warm-up has none, AMRAP is to failure).
            var structural = StructureFields.Where(field => !Same(field, old[field], next[field])).ToList();
            if (structural.Count == 0) continue;
            if (structural.Contains(StructureFlag) || IsAmrap(working[i]) != IsAmrap(after[i])) structural.AddRange(EffortFields);
            var patch = new JsonObject();
            foreach (var field in structural) patch[field] = next[field]?.DeepClone();
            patches[i] = patch;
        }
        return new(removed, patches, after.Skip(working.Count).ToList());
    }

    private const string StructureFlag = "warmup";
    private static readonly string[] StructureFields = [StructureFlag, "notes"];
    private static readonly string[] EffortFields = ["targetRpe", "rir"];

    private static bool IsAmrap(SetPrescription set)
        => set.Notes?.Contains("AMRAP", StringComparison.OrdinalIgnoreCase) == true;

    // Where a value came from is bookkeeping, and an empty note is no note: neither is a change to
    // the program, so a set switched to another type and back does not count as edited.
    private static readonly HashSet<string> Provenance = ["repsSource", "rpeSource", "restSource"];

    private static bool Same(string field, JsonNode? before, JsonNode? after)
    {
        if (Provenance.Contains(field) || JsonNode.DeepEquals(before, after)) return true;
        static bool Blank(JsonNode? node) => node is null || node is JsonValue value && value.TryGetValue<string>(out var text) && text.Length == 0;
        return Blank(before) && Blank(after);
    }

    public List<SetPrescription> Apply(List<SetPrescription> current)
    {
        var next = current.ToList();
        foreach (var index in Removed)
            if (index < next.Count && next.Count > 1) next.RemoveAt(index);
        foreach (var (index, patch) in Patches)
        {
            if (index >= next.Count) continue;
            var row = JsonSerializer.SerializeToNode(next[index], Json.Options)!.AsObject();
            foreach (var field in patch) row[field.Key] = field.Value?.DeepClone();
            next[index] = row.Deserialize<SetPrescription>(Json.Options)!;
        }
        foreach (var row in Appended) if (next.Count < 24) next.Add(row);
        Validation.Prescriptions(next);
        return next;
    }
}
