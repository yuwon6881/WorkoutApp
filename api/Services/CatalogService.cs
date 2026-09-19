using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record CatalogExercise(Guid Id, string Slug, string Name, string Muscle, string Equipment, string Cue, List<string> Aliases, double LoadStepKg,
    string LoadModel = LoadModels.External, string MovementPattern = "", string Source = "catalog", bool IsCustom = false, bool Archived = false);

public record SubstitutionCandidate(Guid ExerciseId, string Name, string Muscle, string Equipment, string Cue,
    string Source, int Rank, bool IsCatalog, string MovementPattern = "");

public sealed class CatalogService(AppDb db)
{
    /// Normalizing on comparison keeps "Barbell Bench-Press" and "barbell bench press" the same key.
    public static string Normalize(string value)
    {
        var cleaned = new string(value.Trim().ToLowerInvariant().Select(c => char.IsAsciiLetterOrDigit(c) ? c : ' ').ToArray());
        return string.Join(' ', cleaned.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    public static bool IsPlaceholder(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return true;
        var norm = Normalize(text);
        return norm is "n a" or "na" or "none" or "see notes" or "see note" or "view notes" or "view note" or "null";
    }

    public async Task<List<CatalogExercise>> All(CancellationToken ct)
    {
        var exercises = await db.Exercises.AsNoTracking().Where(x => x.Active).OrderBy(x => x.Name).ToListAsync(ct);
        var ids = exercises.Select(x => x.Id).ToList();
        var aliases = await db.Aliases.AsNoTracking().Where(a => ids.Contains(a.ExerciseId)).ToListAsync(ct);
        var output = exercises.Select(x => new CatalogExercise(x.Id, x.Slug, x.Name, x.Muscle, x.Equipment, x.Cue,
            aliases.Where(a => a.ExerciseId == x.Id).Select(a => a.Alias).OrderBy(a => a).ToList(), x.LoadStepKg,
            LoadModels.All.Contains(x.LoadModel) ? x.LoadModel : LoadModels.External, x.MovementPattern)).ToList();
        var custom = await db.CustomExercises.AsNoTracking().Where(x => !x.Archived).OrderBy(x => x.Name).ToListAsync(ct);
        output.AddRange(custom.Select(x => new CatalogExercise(x.Id, $"custom-{x.Id:N}", x.Name, x.Muscle, x.Equipment, x.Cue, [], x.LoadStepKg,
            LoadModels.All.Contains(x.LoadModel) ? x.LoadModel : LoadModels.External, x.MovementPattern, "custom", true)));
        return output;
    }

    /// Returns candidates in the server-defined order: imported alternatives first, then curated
    /// movement matches, followed by the searchable catalog. An unresolved imported name remains
    /// a valid candidate with a null id and is never silently mapped to a neighbour.
    public async Task<List<SubstitutionCandidate>> Substitutions(Guid? exerciseId, string? name,
        IEnumerable<string>? importedAlternatives, string? query, CancellationToken ct)
    {
        var all = await All(ct);
        var current = exerciseId is { } id ? all.FirstOrDefault(x => x.Id == id) :
            all.FirstOrDefault(x => Normalize(x.Name) == Normalize(name ?? ""));
        var search = Normalize(query ?? "");
        var output = new List<SubstitutionCandidate>();
        var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var rank = 0;
        foreach (var imported in importedAlternatives ?? [])
        {
            var clean = imported?.Trim() ?? "";
            if (clean.Length == 0 || IsPlaceholder(clean) || !seenNames.Add(Normalize(clean))) continue;
            var match = all.FirstOrDefault(x => Normalize(x.Name) == Normalize(clean) || x.Aliases.Any(a => Normalize(a) == Normalize(clean)));
            if (match == null) continue;
            output.Add(new SubstitutionCandidate(match.Id, match.Name, match.Muscle, match.Equipment, match.Cue,
                "imported", rank++, true, match.MovementPattern));
        }
        IEnumerable<CatalogExercise> filtered = all;
        if (search.Length > 0)
            filtered = filtered.Where(x => Normalize(x.Name).Contains(search) || Normalize(x.Muscle).Contains(search) ||
                Normalize(x.Equipment).Contains(search) || x.Aliases.Any(a => Normalize(a).Contains(search)));
        var similar = current is null ? filtered : filtered.Where(x => x.Id != current.Id &&
            (!string.IsNullOrWhiteSpace(current.MovementPattern) && string.Equals(x.MovementPattern, current.MovementPattern, StringComparison.OrdinalIgnoreCase) ||
             string.Equals(x.Muscle, current.Muscle, StringComparison.OrdinalIgnoreCase) ||
             string.Equals(x.Equipment, current.Equipment, StringComparison.OrdinalIgnoreCase)));
        foreach (var candidate in similar.OrderBy(x => SimilarityScore(current, x)).ThenBy(x => x.Name))
        {
            if (!seenNames.Add(Normalize(candidate.Name))) continue;
            output.Add(new SubstitutionCandidate(candidate.Id, candidate.Name, candidate.Muscle, candidate.Equipment, candidate.Cue,
                "similar", rank++, true, candidate.MovementPattern));
        }
        foreach (var candidate in filtered.OrderBy(x => x.Name))
        {
            if (current?.Id == candidate.Id) continue;
            if (!seenNames.Add(Normalize(candidate.Name))) continue;
            output.Add(new SubstitutionCandidate(candidate.Id, candidate.Name, candidate.Muscle, candidate.Equipment, candidate.Cue,
                "library", rank++, true, candidate.MovementPattern));
        }
        return output;
    }

    private static int SimilarityScore(CatalogExercise? source, CatalogExercise candidate)
    {
        if (source is null) return 0;
        var score = 0;
        if (!string.IsNullOrWhiteSpace(source.MovementPattern) && string.Equals(source.MovementPattern, candidate.MovementPattern, StringComparison.OrdinalIgnoreCase)) score -= 4;
        if (string.Equals(source.Muscle, candidate.Muscle, StringComparison.OrdinalIgnoreCase)) score -= 2;
        if (string.Equals(source.Equipment, candidate.Equipment, StringComparison.OrdinalIgnoreCase)) score--;
        return score;
    }

    /// Returns the catalog id for a written name, or null when nothing matches.
    /// An unmatched name stays unresolved; it is never guessed into a neighbouring exercise.
    /// Every name the library answers to, against the exercise it names. A caller with many names
    /// to place — an import draft is a hundred of them — builds this once and asks it directly,
    /// rather than reading the whole catalog again for each name. It is never held between calls:
    /// A reviewer can choose an exercise explicitly when an import name was not matched.
    public async Task<Dictionary<string, Guid>> MatchIndex(CancellationToken ct)
    {
        var built = new Dictionary<string, Guid>(StringComparer.Ordinal);
        // Later entries never displace earlier ones, so a curated alias keeps its exercise when a
        // custom name happens to normalise to the same words.
        foreach (var alias in await db.Aliases.AsNoTracking().ToListAsync(ct)) built.TryAdd(alias.Normalized, alias.ExerciseId);
        foreach (var exercise in await db.Exercises.AsNoTracking().Where(x => x.Active).ToListAsync(ct)) built.TryAdd(Normalize(exercise.Name), exercise.Id);
        foreach (var custom in await db.CustomExercises.AsNoTracking().Where(x => !x.Archived).ToListAsync(ct)) built.TryAdd(Normalize(custom.Name), custom.Id);
        return built;
    }

    public async Task<Guid?> Match(string name, CancellationToken ct)
        => CatalogMatching.Find(await MatchIndex(ct), name);

    public async Task<HashSet<Guid>> ActiveIds(CancellationToken ct)
    {
        var ids = await db.Exercises.AsNoTracking().Where(x => x.Active).Select(x => x.Id).ToListAsync(ct);
        ids.AddRange(await db.CustomExercises.AsNoTracking().Where(x => !x.Archived).Select(x => x.Id).ToListAsync(ct));
        return ids.ToHashSet();
    }

    public async Task RequireActive(Guid? id, CancellationToken ct)
    {
        if (id == null) return;
        var catalog = await db.Exercises.AsNoTracking().AnyAsync(x => x.Id == id && x.Active, ct);
        var custom = await db.CustomExercises.AsNoTracking().AnyAsync(x => x.Id == id && !x.Archived, ct);
        Validation.Require(catalog || custom, "That exercise is not in the library.", 400);
    }

    public async Task<Dictionary<Guid, string>> LoadModelsFor(IEnumerable<Guid?> ids, CancellationToken ct)
    {
        var wanted = ids.Where(id => id != null).Select(id => id!.Value).Distinct().ToList();
        if (wanted.Count == 0) return [];
        var output = await db.Exercises.AsNoTracking().Where(x => wanted.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => LoadModels.All.Contains(x.LoadModel) ? x.LoadModel : LoadModels.External, ct);
        // Archived custom exercises stay readable for historical/template references. They are
        // excluded from the picker and RequireActive, but their original load model is needed
        // when an existing prescription is opened.
        var custom = await db.CustomExercises.AsNoTracking().Where(x => wanted.Contains(x.Id)).ToListAsync(ct);
        foreach (var row in custom) output[row.Id] = LoadModels.All.Contains(row.LoadModel) ? row.LoadModel : LoadModels.External;
        return output;
    }

    public async Task<string> NameFor(Guid id, CancellationToken ct)
    {
        var name = await db.Exercises.AsNoTracking().Where(x => x.Id == id && x.Active).Select(x => x.Name).SingleOrDefaultAsync(ct);
        if (name != null) return name;
        name = await db.CustomExercises.AsNoTracking().Where(x => x.Id == id).Select(x => x.Name).SingleOrDefaultAsync(ct);
        Validation.Require(name != null, "That exercise is not in the library.", 400);
        return name!;
    }

    public async Task<Dictionary<Guid, string>> MusclesFor(IEnumerable<Guid> ids, CancellationToken ct)
    {
        var wanted = ids.Distinct().ToList();
        if (wanted.Count == 0) return [];
        var output = await db.Exercises.AsNoTracking().Where(x => wanted.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.Muscle, ct);
        var custom = await db.CustomExercises.AsNoTracking().Where(x => wanted.Contains(x.Id)).ToListAsync(ct);
        foreach (var row in custom) output[row.Id] = row.Muscle;
        return output;
    }
}
