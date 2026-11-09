using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

public static class ExerciseWeightBasis
{
    // Resolve by identity, including archived custom exercises and legacy catalog identities.
    // A swap or restore changes the identity, so the response immediately gets its own basis.
    public static async Task<Dictionary<Guid, string>> Read(AppDb db, IEnumerable<Guid?> ids, CancellationToken ct)
    {
        var wanted = ids.OfType<Guid>().Distinct().ToList();
        if (wanted.Count == 0) return [];
        var shared = await CatalogMetadata.Read(db, ct);
        var output = wanted.Where(shared.ContainsKey).Select(id => shared[id]).ToDictionary(x => x.Id, x => x.WeightBasis);
        var custom = await db.CustomExercises.AsNoTracking().Where(x => wanted.Contains(x.Id))
            .Select(x => new { x.Id, x.WeightBasis }).ToListAsync(ct);
        foreach (var row in custom) output[row.Id] = row.WeightBasis;
        return output;
    }
}
