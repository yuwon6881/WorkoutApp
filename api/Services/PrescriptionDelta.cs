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
            var patch = new JsonObject();
            foreach (var field in next)
                if (!JsonNode.DeepEquals(old[field.Key], field.Value)) patch[field.Key] = field.Value?.DeepClone();
            if (patch.Count > 0) patches[i] = patch;
        }
        return new(removed, patches, after.Skip(working.Count).ToList());
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
