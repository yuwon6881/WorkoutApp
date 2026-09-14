using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record CatalogExercise(Guid Id, string Slug, string Name, string Muscle, string Equipment, string Cue, List<string> Aliases, double LoadStepKg,
    string LoadModel = LoadModels.External);

public sealed class CatalogService(AppDb db)
{
    /// Normalizing on comparison keeps "Barbell Bench-Press" and "barbell bench press" the same key.
    public static string Normalize(string value)
    {
        var cleaned = new string(value.Trim().ToLowerInvariant().Select(c => char.IsAsciiLetterOrDigit(c) ? c : ' ').ToArray());
        return string.Join(' ', cleaned.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    public async Task<List<CatalogExercise>> All(CancellationToken ct)
    {
        var exercises = await db.Exercises.AsNoTracking().Where(x => x.Active).OrderBy(x => x.Name).ToListAsync(ct);
        var ids = exercises.Select(x => x.Id).ToList();
        var aliases = await db.Aliases.AsNoTracking().Where(a => ids.Contains(a.ExerciseId)).ToListAsync(ct);
        return exercises.Select(x => new CatalogExercise(x.Id, x.Slug, x.Name, x.Muscle, x.Equipment, x.Cue,
            aliases.Where(a => a.ExerciseId == x.Id).Select(a => a.Alias).OrderBy(a => a).ToList(), x.LoadStepKg,
            LoadModels.All.Contains(x.LoadModel) ? x.LoadModel : LoadModels.External)).ToList();
    }

    /// Returns the catalog id for a written name, or null when nothing matches.
    /// An unmatched name stays unresolved; it is never guessed into a neighbouring exercise.
    public async Task<Guid?> Match(string name, CancellationToken ct)
    {
        var key = Normalize(name);
        if (key.Length == 0) return null;
        var alias = await db.Aliases.AsNoTracking().FirstOrDefaultAsync(a => a.Normalized == key, ct);
        if (alias != null) return alias.ExerciseId;
        var exercises = await db.Exercises.AsNoTracking().Where(x => x.Active).ToListAsync(ct);
        return exercises.FirstOrDefault(x => Normalize(x.Name) == key)?.Id;
    }

    public async Task<HashSet<Guid>> ActiveIds(CancellationToken ct)
        => (await db.Exercises.AsNoTracking().Where(x => x.Active).Select(x => x.Id).ToListAsync(ct)).ToHashSet();

    public async Task RequireActive(Guid? id, CancellationToken ct)
    {
        if (id == null) return;
        Validation.Require(await db.Exercises.AsNoTracking().AnyAsync(x => x.Id == id && x.Active, ct), "That exercise is not in the library.", 400);
    }

    public async Task<Dictionary<Guid, string>> LoadModelsFor(IEnumerable<Guid?> ids, CancellationToken ct)
    {
        var wanted = ids.Where(id => id != null).Select(id => id!.Value).Distinct().ToList();
        if (wanted.Count == 0) return [];
        return await db.Exercises.AsNoTracking().Where(x => wanted.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => LoadModels.All.Contains(x.LoadModel) ? x.LoadModel : LoadModels.External, ct);
    }
}
